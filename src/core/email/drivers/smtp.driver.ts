import { Logger } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";

import type { EmailDriver, EmailMessage, EmailSendResult } from "../email.service.js";

/**
 * SmtpEmailDriver — Nodemailer-backed driver for plain SMTP delivery.
 *
 * The driver is intentionally thin glue around a `Transporter` so it
 * stays trivially mockable in tests. Anything resembling logic
 * (payload-shaping, error classification) lives in
 * `composeSmtpPayload` / `classifySmtpError`, which are pure helpers.
 *
 * Why we accept a `Transporter` via the constructor: the production
 * factory (`createSmtpTransporter`) wires Nodemailer's real connection
 * pool, but tests can pass any object that satisfies `SmtpTransporter`
 * — typically an in-memory fake. That keeps the driver story tests
 * free of network I/O without leaning on Nodemailer's `jsonTransport`.
 *
 * Retry / outbox semantics: this driver returns success/failure for a
 * single attempt. Re-sends are the outbox layer's job (#11 — outbox
 * + retry policy live there, not here). Connection pooling is enabled
 * by default; the operator picks the pool size via `SMTP_POOL_SIZE`.
 */
export interface SmtpTransporter {
  sendMail(envelope: SmtpPayload): Promise<{ messageId: string }>;
}

export interface SmtpPayload {
  to: string;
  from: string;
  subject: string;
  html?: string;
  text?: string;
}

export interface SmtpEmailDriverOptions {
  transporter: SmtpTransporter;
}

export interface SmtpConnectionConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  /** SMTP_SECURE=true → TLS on 465, false → STARTTLS on 587. */
  secure: boolean;
  /** Per-connection timeout. Outbox handles retry; we just fail fast. */
  timeoutMs?: number;
  /** How many parallel SMTP connections may be open against the relay. */
  poolSize?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_POOL_SIZE = 5;

/**
 * Pure planner — shapes the Nodemailer envelope from an EmailMessage.
 *
 * Splitting this out keeps the I/O-bound `send()` method testable
 * without spinning up a transporter. Optional fields (`html`, `text`)
 * are dropped from the envelope when missing so Nodemailer's own
 * defaults apply.
 */
export function composeSmtpPayload(msg: EmailMessage): SmtpPayload {
  if (!msg.from) {
    throw new Error("smtp: 'from' is required (default-from must be applied before composing)");
  }
  const payload: SmtpPayload = {
    to: msg.to,
    from: msg.from,
    subject: msg.subject,
  };
  if (msg.html !== undefined) payload.html = msg.html;
  if (msg.text !== undefined) payload.text = msg.text;
  return payload;
}

export class SmtpEmailDriver implements EmailDriver {
  readonly name = "smtp";
  private readonly logger = new Logger("SmtpEmailDriver");

  constructor(private readonly options: SmtpEmailDriverOptions) {}

  async send(msg: EmailMessage): Promise<EmailSendResult> {
    const payload = composeSmtpPayload(msg);
    try {
      const result = await this.options.transporter.sendMail(payload);
      return { messageId: result.messageId, driver: this.name };
    } catch (err) {
      // Verbose log — operators searching CI for "EAUTH" etc. need the
      // full error out of the box, otherwise diagnosis takes hours.
      this.logger.error(
        `[smtp] sendMail failed: to=${payload.to} subject="${payload.subject}" err=${formatError(err)}`,
      );
      throw err;
    }
  }

  async sendTemplate(
    _msg: EmailMessage,
    _templateId: number,
    _vars: object,
  ): Promise<EmailSendResult> {
    throw new Error("smtp does not support brevoTemplateId — use the Brevo driver instead");
  }
}

/**
 * Production transporter factory — wires Nodemailer's connection pool
 * with sane timeouts. Returns `null` when no host is configured so the
 * caller can fall back to a log-only driver in fully-offline dev.
 *
 * `secure: true` ⇒ port 465 (implicit TLS). For port 587 with STARTTLS,
 * pass `secure: false` and Nodemailer auto-upgrades the connection
 * (`requireTLS: true` makes the upgrade mandatory).
 */
export function createSmtpTransporter(
  cfg: SmtpConnectionConfig,
): Transporter & SmtpTransporter {
  const auth = cfg.user
    ? { user: cfg.user, pass: cfg.pass ?? "" }
    : undefined;
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: !cfg.secure,
    pool: true,
    maxConnections: cfg.poolSize ?? DEFAULT_POOL_SIZE,
    connectionTimeout: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    greetingTimeout: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    socketTimeout: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(auth ? { auth } : {}),
  });
}

/**
 * Pure planner — derives the SMTP-driver config from a flat env map.
 * Returns `null` if no `SMTP_HOST` is set (caller falls back to log-only).
 */
export function readSmtpConfigFromEnv(env: Record<string, string | undefined>): SmtpConnectionConfig | null {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(env.SMTP_PORT ?? "1025");
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`smtp: invalid SMTP_PORT="${env.SMTP_PORT}"`);
  }
  const secure = env.SMTP_SECURE === "true" || env.SMTP_SECURE === "1";
  const cfg: SmtpConnectionConfig = { host, port, secure };
  if (env.SMTP_USER) cfg.user = env.SMTP_USER;
  if (env.SMTP_PASS) cfg.pass = env.SMTP_PASS;
  if (env.SMTP_TIMEOUT_MS) {
    const ms = Number(env.SMTP_TIMEOUT_MS);
    if (Number.isFinite(ms) && ms > 0) cfg.timeoutMs = ms;
  }
  if (env.SMTP_POOL_SIZE) {
    const n = Number(env.SMTP_POOL_SIZE);
    if (Number.isFinite(n) && n > 0) cfg.poolSize = n;
  }
  return cfg;
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as Error & { code?: string }).code;
    return code ? `${code}: ${err.message}` : err.message;
  }
  return String(err);
}
