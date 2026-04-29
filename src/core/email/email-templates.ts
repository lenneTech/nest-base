import type { EmailRenderedTemplate, EmailTemplateRenderer } from "./email.service.js";

/**
 * Email-Templates (PLAN.md §9.2 + §32 Phase 6).
 *
 * Two pieces glued together:
 *   1. A locale-aware registry — `name + locale` first, plain `name`
 *      as the default fallback. Lookups never throw; renderer decides.
 *   2. A renderer that walks an EJS *subset* (just enough for what
 *      our four built-in templates need today):
 *
 *        <%= expr %>   HTML-escaped substitution
 *        <%- expr %>   raw substitution
 *        <%# … %>      comment (dropped)
 *
 *      Loops, conditionals, includes are not in scope — the moment a
 *      real template needs them we replace this engine with the `ejs`
 *      package, but that's a deliberate next slice, not a YAGNI bet.
 *
 * Variable resolution supports dotted paths (`user.name`). Missing
 * variables throw — silent rendering is how XSS-hardened pipelines
 * fail open in production, and we'd rather notice in dev.
 */

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export interface EmailTemplateRegistry {
  get(name: string, locale: string): EmailTemplate | undefined;
  register(name: string, locale: string | null, template: EmailTemplate): void;
}

export class EmailTemplateNotFoundError extends Error {
  constructor(name: string, locale: string) {
    super(`email-templates: template "${name}" (locale="${locale}") not found`);
    this.name = "EmailTemplateNotFoundError";
  }
}

export class MissingTemplateVariableError extends Error {
  constructor(path: string) {
    super(`email-templates: missing variable "${path}"`);
    this.name = "MissingTemplateVariableError";
  }
}

export class InMemoryEmailTemplateRegistry implements EmailTemplateRegistry {
  private readonly entries = new Map<string, EmailTemplate>();

  register(name: string, locale: string | null, template: EmailTemplate): void {
    this.entries.set(this.key(name, locale), template);
  }

  get(name: string, locale: string): EmailTemplate | undefined {
    return this.entries.get(this.key(name, locale)) ?? this.entries.get(this.key(name, null));
  }

  private key(name: string, locale: string | null): string {
    return locale ? `${name}::${locale}` : name;
  }
}

export class EjsEmailTemplateRenderer implements EmailTemplateRenderer {
  constructor(private readonly registry: EmailTemplateRegistry) {}

  async render(template: string, locale: string, vars: object): Promise<EmailRenderedTemplate> {
    const found = this.registry.get(template, locale);
    if (!found) throw new EmailTemplateNotFoundError(template, locale);
    return {
      subject: renderSection(found.subject, vars as Record<string, unknown>),
      html: renderSection(found.html, vars as Record<string, unknown>),
      text: renderSection(found.text, vars as Record<string, unknown>),
    };
  }
}

const TAG_RE = /<%([=#-])\s*([\s\S]*?)\s*%>/g;

function renderSection(source: string, vars: Record<string, unknown>): string {
  return source.replace(TAG_RE, (_match, kind: string, expr: string) => {
    if (kind === "#") return "";
    const value = resolvePath(vars, expr.trim());
    const stringified = String(value);
    return kind === "=" ? escapeHtml(stringified) : stringified;
  });
}

function resolvePath(vars: Record<string, unknown>, path: string): unknown {
  let current: unknown = vars;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object" || !(segment in (current as object))) {
      throw new MissingTemplateVariableError(path);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Built-in templates — minimal copy that proves the rendering surface.
 * Apps replace or extend these via `registry.register()`.
 */
export function buildBuiltInEmailTemplateRegistry(): EmailTemplateRegistry {
  const reg = new InMemoryEmailTemplateRegistry();

  reg.register("email-verification", null, {
    subject: "Please verify your email",
    html:
      "<p>Hello <%= recipientName %>,</p>" +
      '<p>Please verify your email by visiting <a href="<%= verificationUrl %>"><%= verificationUrl %></a>.</p>',
    text: "Hello <%= recipientName %>,\n\nPlease verify your email: <%= verificationUrl %>",
  });

  reg.register("password-reset", null, {
    subject: "Reset your password",
    html:
      "<p>Hello <%= recipientName %>,</p>" +
      '<p>Reset your password by visiting <a href="<%= resetUrl %>"><%= resetUrl %></a>.</p>' +
      "<p>If you did not request this, ignore this email.</p>",
    text: "Hello <%= recipientName %>,\n\nReset your password: <%= resetUrl %>",
  });

  reg.register("welcome", null, {
    subject: "Welcome to <%= appName %>",
    html: "<p>Hello <%= recipientName %>,</p><p>Welcome to <%= appName %>!</p>",
    text: "Hello <%= recipientName %>,\n\nWelcome to <%= appName %>!",
  });

  reg.register("invitation", null, {
    subject: "You have been invited to <%= appName %>",
    html:
      "<p>Hello <%= recipientName %>,</p>" +
      "<p><%= senderName %> has invited you to join <%= appName %>.</p>" +
      '<p>Accept the invitation: <a href="<%= acceptUrl %>"><%= acceptUrl %></a></p>',
    text:
      "Hello <%= recipientName %>,\n\n<%= senderName %> has invited you to join <%= appName %>.\n" +
      "Accept the invitation: <%= acceptUrl %>",
  });

  return reg;
}
