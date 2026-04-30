import { Logger } from "@nestjs/common";

import type { EmailDriver, EmailMessage, EmailSendResult } from "../email.service.js";

/**
 * BrevoEmailDriver — HTTP-only driver against the Brevo SMTP-relay API.
 *
 * We deliberately do NOT depend on `@getbrevo/brevo`: that SDK pulls in
 * a heavy generated client tree we'd otherwise tree-shake to nothing.
 * A 60-line `fetch`-based client stays in our test surface and is the
 * cheaper transitive footprint long-term.
 *
 * Logic split (planner / runner):
 *   composeBrevoSendPayload     → /v3/smtp/email body for plain sends
 *   composeBrevoTemplatePayload → /v3/smtp/email body for templated sends
 *   mapBrevoTemplate            → normalises Brevo's API JSON
 * The driver methods are thin wrappers calling those planners, then
 * the injected `BrevoHttpClient`. Tests stub the HTTP client; nothing
 * goes to the network.
 *
 * Read-side methods (`listTemplates`, `getTemplate`) feed Issue #9's
 * Brevo Read-Only tab. They always require a valid API key — even when
 * Brevo is the inactive driver — because the dev tooling needs to peek
 * at the production templates from a dev machine.
 */
export interface BrevoHttpRequest {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
}

export interface BrevoHttpResponse {
  status: number;
  body: unknown;
}

export interface BrevoHttpClient {
  request(req: BrevoHttpRequest): Promise<BrevoHttpResponse>;
}

export interface BrevoEmailDriverOptions {
  apiKey: string;
  http: BrevoHttpClient;
}

export interface BrevoSendPayload {
  sender: { email: string; name?: string };
  to: Array<{ email: string; name?: string }>;
  subject: string;
  htmlContent?: string;
  textContent?: string;
}

export interface BrevoTemplatePayload {
  sender: { email: string };
  to: Array<{ email: string }>;
  templateId: number;
  params: object;
}

export interface BrevoTemplateSummary {
  id: number;
  name: string;
  subject: string;
  isActive: boolean;
}

export interface BrevoTemplate extends BrevoTemplateSummary {
  htmlContent?: string;
  replyTo?: string;
  sender?: { name?: string; email?: string };
  createdAt?: string;
  modifiedAt?: string;
}

export class BrevoMissingApiKeyError extends Error {
  constructor() {
    super("brevo: BREVO_API_KEY is not set — refusing to call the Brevo API");
    this.name = "BrevoMissingApiKeyError";
  }
}

export class BrevoApiError extends Error {
  readonly status: number;
  readonly responseBody: unknown;
  constructor(status: number, responseBody: unknown) {
    const detail =
      responseBody && typeof responseBody === "object" && "message" in responseBody
        ? String((responseBody as { message?: string }).message ?? "")
        : "";
    super(`brevo: HTTP ${status}${detail ? ` — ${detail}` : ""}`);
    this.name = "BrevoApiError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export function composeBrevoSendPayload(msg: EmailMessage): BrevoSendPayload {
  if (!msg.from) {
    throw new Error("brevo: 'from' is required (default-from must be applied before composing)");
  }
  const payload: BrevoSendPayload = {
    sender: { email: msg.from },
    to: [{ email: msg.to }],
    subject: msg.subject,
  };
  if (msg.html !== undefined) payload.htmlContent = msg.html;
  if (msg.text !== undefined) payload.textContent = msg.text;
  return payload;
}

export function composeBrevoTemplatePayload(
  msg: EmailMessage,
  templateId: number,
  vars: object,
): BrevoTemplatePayload {
  if (!msg.from) {
    throw new Error("brevo: 'from' is required for template send");
  }
  return {
    sender: { email: msg.from },
    to: [{ email: msg.to }],
    templateId,
    params: vars,
  };
}

/**
 * Map raw Brevo /v3/smtp/templates JSON onto our internal shape.
 * Required: `id`, `name`, `subject`, `isActive`. Anything else is best-
 * effort and dropped if missing — the dev-tooling tab tolerates partial
 * data, but the bare-minimum identity must be present or the row is
 * useless.
 */
export function mapBrevoTemplate(raw: unknown): BrevoTemplate {
  if (!raw || typeof raw !== "object") {
    throw new Error("brevo: template payload is not an object");
  }
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "number" ? r.id : undefined;
  const name = typeof r.name === "string" ? r.name : undefined;
  const subject = typeof r.subject === "string" ? r.subject : undefined;
  const isActive = typeof r.isActive === "boolean" ? r.isActive : undefined;
  if (id === undefined) throw new Error("brevo: template missing 'id'");
  if (name === undefined) throw new Error("brevo: template missing 'name'");
  if (subject === undefined) throw new Error("brevo: template missing 'subject'");
  if (isActive === undefined) throw new Error("brevo: template missing 'isActive'");
  const tpl: BrevoTemplate = { id, name, subject, isActive };
  if (typeof r.htmlContent === "string") tpl.htmlContent = r.htmlContent;
  if (typeof r.replyTo === "string") tpl.replyTo = r.replyTo;
  if (typeof r.createdAt === "string") tpl.createdAt = r.createdAt;
  if (typeof r.modifiedAt === "string") tpl.modifiedAt = r.modifiedAt;
  if (r.sender && typeof r.sender === "object") {
    const s = r.sender as { name?: unknown; email?: unknown };
    const sender: { name?: string; email?: string } = {};
    if (typeof s.name === "string") sender.name = s.name;
    if (typeof s.email === "string") sender.email = s.email;
    tpl.sender = sender;
  }
  return tpl;
}

export class BrevoEmailDriver implements EmailDriver {
  readonly name = "brevo";
  private readonly logger = new Logger("BrevoEmailDriver");

  constructor(private readonly options: BrevoEmailDriverOptions) {}

  async send(msg: EmailMessage): Promise<EmailSendResult> {
    this.assertApiKey();
    const body = composeBrevoSendPayload(msg);
    const res = await this.options.http.request({
      method: "POST",
      path: "/v3/smtp/email",
      body,
    });
    if (res.status < 200 || res.status >= 300) {
      this.logger.error(
        `[brevo] send failed: status=${res.status} body=${JSON.stringify(res.body)}`,
      );
      throw new BrevoApiError(res.status, res.body);
    }
    const messageId = pickMessageId(res.body);
    return { messageId, driver: this.name };
  }

  async sendTemplate(
    msg: EmailMessage,
    templateId: number,
    vars: object,
  ): Promise<EmailSendResult> {
    this.assertApiKey();
    const body = composeBrevoTemplatePayload(msg, templateId, vars);
    const res = await this.options.http.request({
      method: "POST",
      path: "/v3/smtp/email",
      body,
    });
    if (res.status < 200 || res.status >= 300) {
      this.logger.error(
        `[brevo] sendTemplate failed: id=${templateId} status=${res.status} body=${JSON.stringify(res.body)}`,
      );
      throw new BrevoApiError(res.status, res.body);
    }
    const messageId = pickMessageId(res.body);
    return { messageId, driver: this.name };
  }

  async listTemplates(opts: { limit?: number; offset?: number }): Promise<BrevoTemplateSummary[]> {
    this.assertApiKey();
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const res = await this.options.http.request({
      method: "GET",
      path: `/v3/smtp/templates?limit=${limit}&offset=${offset}`,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new BrevoApiError(res.status, res.body);
    }
    const body = res.body as { templates?: unknown[] };
    if (!Array.isArray(body.templates)) return [];
    return body.templates.map(mapBrevoTemplate);
  }

  async getTemplate(id: number): Promise<BrevoTemplate> {
    this.assertApiKey();
    const res = await this.options.http.request({
      method: "GET",
      path: `/v3/smtp/templates/${id}`,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new BrevoApiError(res.status, res.body);
    }
    return mapBrevoTemplate(res.body);
  }

  private assertApiKey(): void {
    if (!this.options.apiKey) throw new BrevoMissingApiKeyError();
  }
}

const BREVO_BASE_URL = "https://api.brevo.com";

/**
 * Production Brevo HTTP client built on top of the platform `fetch`.
 * Adds the `api-key` header and surfaces the response body as JSON
 * (or `null` for empty 204s). Keeps the client interface tiny so tests
 * can stub it without `nock`/`msw`.
 */
export function createBrevoHttpClient(opts: { apiKey: string; baseUrl?: string }): BrevoHttpClient {
  const baseUrl = opts.baseUrl ?? BREVO_BASE_URL;
  return {
    async request(req) {
      const url = `${baseUrl}${req.path}`;
      const init: RequestInit = {
        method: req.method,
        headers: {
          "api-key": opts.apiKey,
          accept: "application/json",
          ...(req.body !== undefined ? { "content-type": "application/json" } : {}),
        },
      };
      if (req.body !== undefined) init.body = JSON.stringify(req.body);
      const res = await fetch(url, init);
      const text = await res.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      return { status: res.status, body };
    },
  };
}

function pickMessageId(body: unknown): string {
  if (body && typeof body === "object" && "messageId" in body) {
    const id = (body as { messageId?: unknown }).messageId;
    if (typeof id === "string") return id;
  }
  return `brevo-${Date.now()}`;
}
