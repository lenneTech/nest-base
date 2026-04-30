/**
 * EmailService.
 *
 * Two-driver design — `primary` (Nodemailer/SMTP) renders EJS
 * templates server-side, `transactional` (Brevo) takes a
 * Brevo-template-id and lets Brevo do the rendering. The service
 * decides per-call which path to take.
 *
 *     send()         → primary, no rendering, body comes from caller
 *     sendTemplate() → brevoTemplateId   → transactional driver
 *                       (no Id)          → renderer + primary
 *
 * Delivery modes (per call, see SendDispatchOptions):
 *   - `direct`  (default) — synchronous driver call; the returned
 *                EmailSendResult carries the real provider
 *                message-id.
 *   - `outbox`            — write the request to the email-outbox
 *                table and return immediately with a synthetic
 *                `outbox:<uuid>` message-id and `driver: "outbox"`.
 *                The actual transport happens on the worker
 *                (EmailOutboxWorker) with exponential backoff and
 *                dead-letter on persistent failure. Better-Auth
 *                hooks (#8) opt into this mode so a crash between
 *                trigger and SMTP-ACK doesn't lose verification
 *                mails.
 *
 * Two cross-cutting concerns sit in front of every send (in BOTH
 * modes — dev whitelist + rate-limit run before the outbox write
 * so a denied recipient never reaches the worker):
 *   - dev whitelist (only allow specific recipient patterns)
 *   - per-recipient rate-limit
 *
 * Both are optional injections so a production setup with strict
 * outbound rules can be assembled, while local dev stays loose.
 */

export interface EmailMessage {
  to: string;
  from?: string;
  subject: string;
  html?: string;
  text?: string;
}

export interface EmailSendResult {
  messageId: string;
  driver: string;
}

export interface EmailDriver {
  name: string;
  send(msg: EmailMessage): Promise<EmailSendResult>;
  sendTemplate(msg: EmailMessage, templateId: number, vars: object): Promise<EmailSendResult>;
}

export interface EmailRenderedTemplate {
  subject: string;
  html: string;
  text: string;
}

export interface EmailTemplateRenderer {
  render(template: string, locale: string, vars: object): Promise<EmailRenderedTemplate>;
}

export interface EmailRateLimitDecision {
  allowed: boolean;
  resetMs?: number;
}

export interface EmailRateLimiter {
  check(recipient: string): EmailRateLimitDecision;
  record(recipient: string): void;
}

export interface EmailServiceOptions {
  primary: EmailDriver;
  transactional?: EmailDriver;
  renderer: EmailTemplateRenderer;
  defaultFrom: string;
  devWhitelist?: string[];
  rateLimit?: EmailRateLimiter;
  /**
   * Optional outbox enqueuer — when set, callers may pass
   * `mode: "outbox"` to defer transport to the worker. When unset,
   * `mode: "outbox"` throws `EmailOutboxNotConfiguredError`.
   */
  outbox?: EmailOutboxEnqueuer;
}

export interface SendOptions {
  to: string;
  from?: string;
  subject: string;
  html?: string;
  text?: string;
}

export interface SendTemplateOptions {
  to: string;
  template: string;
  locale?: string;
  vars?: object;
  brevoTemplateId?: number;
  from?: string;
}

/**
 * Per-call dispatch options.
 *
 * `mode` defaults to `"direct"` for backwards compatibility with
 * pre-#11 callers. The Better-Auth hook layer is the canonical
 * `"outbox"` consumer; project code may opt in case-by-case.
 */
export interface SendDispatchOptions {
  mode?: "direct" | "outbox";
  /**
   * Idempotency token forwarded to the outbox enqueuer. Two
   * `mode: "outbox"` calls with the same key dedupe to a single
   * outbox row — the second call returns the same synthetic id.
   * Ignored in `direct` mode.
   */
  idempotencyKey?: string;
}

/**
 * Structural slice of `EmailOutboxRecorder` consumed by the service.
 *
 * Restricting the contract to `enqueue()` keeps the unit tests free
 * of storage / driver / planner concerns — they pass a tiny fake
 * that records the call.
 */
export interface EmailOutboxEnqueuer {
  enqueue(input: {
    kind: "send" | "sendTemplate";
    payload: SendOptions | SendTemplateOptions;
    idempotencyKey?: string;
  }): Promise<{ id: string; kind: "send" | "sendTemplate"; payload: unknown; status: string }>;
}

export class EmailRecipientNotAllowedError extends Error {
  constructor(recipient: string) {
    super(`email: recipient "${recipient}" is not in the dev whitelist`);
    this.name = "EmailRecipientNotAllowedError";
  }
}

export class EmailRateLimitedError extends Error {
  constructor(recipient: string, resetMs?: number) {
    super(
      `email: rate limit reached for "${recipient}"${resetMs ? ` (reset in ${resetMs}ms)` : ""}`,
    );
    this.name = "EmailRateLimitedError";
  }
}

export class TransactionalDriverMissingError extends Error {
  constructor() {
    super("email: brevoTemplateId is set but no transactional driver was configured");
    this.name = "TransactionalDriverMissingError";
  }
}

export class EmailOutboxNotConfiguredError extends Error {
  constructor() {
    super('email: mode "outbox" requested but no outbox enqueuer was configured');
    this.name = "EmailOutboxNotConfiguredError";
  }
}

export class EmailService {
  constructor(private readonly options: EmailServiceOptions) {}

  async send(opts: SendOptions, dispatch?: SendDispatchOptions): Promise<EmailSendResult> {
    this.assertAllowed(opts.to);
    this.assertWithinRateLimit(opts.to);
    if (dispatch?.mode === "outbox") {
      const result = await this.enqueueViaOutbox("send", opts, dispatch.idempotencyKey);
      this.options.rateLimit?.record(opts.to);
      return result;
    }
    const message = this.composeMessage(opts);
    const result = await this.options.primary.send(message);
    this.options.rateLimit?.record(opts.to);
    return result;
  }

  async sendTemplate(
    opts: SendTemplateOptions,
    dispatch?: SendDispatchOptions,
  ): Promise<EmailSendResult> {
    this.assertAllowed(opts.to);
    this.assertWithinRateLimit(opts.to);
    if (dispatch?.mode === "outbox") {
      const result = await this.enqueueViaOutbox("sendTemplate", opts, dispatch.idempotencyKey);
      this.options.rateLimit?.record(opts.to);
      return result;
    }
    const vars = opts.vars ?? {};
    let result: EmailSendResult;
    if (opts.brevoTemplateId !== undefined) {
      if (!this.options.transactional) throw new TransactionalDriverMissingError();
      const baseMessage: EmailMessage = {
        to: opts.to,
        from: opts.from ?? this.options.defaultFrom,
        subject: "",
      };
      result = await this.options.transactional.sendTemplate(
        baseMessage,
        opts.brevoTemplateId,
        vars,
      );
    } else {
      const locale = opts.locale ?? "en";
      const rendered = await this.options.renderer.render(opts.template, locale, vars);
      const message: EmailMessage = {
        to: opts.to,
        from: opts.from ?? this.options.defaultFrom,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      };
      result = await this.options.primary.send(message);
    }
    this.options.rateLimit?.record(opts.to);
    return result;
  }

  private async enqueueViaOutbox(
    kind: "send" | "sendTemplate",
    payload: SendOptions | SendTemplateOptions,
    idempotencyKey?: string,
  ): Promise<EmailSendResult> {
    if (!this.options.outbox) throw new EmailOutboxNotConfiguredError();
    const record = await this.options.outbox.enqueue({
      kind,
      payload,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    return { messageId: `outbox:${record.id}`, driver: "outbox" };
  }

  private composeMessage(opts: SendOptions): EmailMessage {
    return {
      to: opts.to,
      from: opts.from ?? this.options.defaultFrom,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    };
  }

  private assertAllowed(recipient: string): void {
    const whitelist = this.options.devWhitelist;
    if (!whitelist || whitelist.length === 0) return;
    for (const pattern of whitelist) {
      if (matchesPattern(recipient, pattern)) return;
    }
    throw new EmailRecipientNotAllowedError(recipient);
  }

  private assertWithinRateLimit(recipient: string): void {
    const decision = this.options.rateLimit?.check(recipient);
    if (decision && !decision.allowed) {
      throw new EmailRateLimitedError(recipient, decision.resetMs);
    }
  }
}

function matchesPattern(recipient: string, pattern: string): boolean {
  if (pattern === recipient) return true;
  if (!pattern.includes("*")) return false;
  // Translate `*@example.com` style globs into a regex anchored at both ends.
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(recipient);
}
