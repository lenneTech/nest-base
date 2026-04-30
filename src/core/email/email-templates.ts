import { defaultBrandConfig, type BrandConfig } from "./brand.js";
import type { EmailRenderedTemplate, EmailTemplateRenderer } from "./email.service.js";

/**
 * Email-Templates.
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
 * Built-in templates — share the dark + electric-lime theme of the
 * Dev Hub so transactional mails feel part of the same product
 * surface. Inline styles only (no <style> blocks, no <link> tags) —
 * that's the lowest common denominator across email clients
 * (Gmail/Outlook/Apple Mail strip <style> tags or scope-rewrite
 * them, but inline styles render reliably).
 *
 * The wrapper builds: container card + brand row + main copy +
 * primary button (when an action URL is supplied) + footer hint.
 * The `<%= … %>` substitutions are EJS-subset placeholders processed
 * by `EjsEmailTemplateRenderer`.
 *
 * Apps replace or extend these via `registry.register()`. Keep the
 * subject + at least one paragraph — the renderer fails loudly if a
 * required variable is missing, which is much better than silently
 * sending half-rendered emails to real users.
 */

interface MailBodyOptions {
  greeting: string;
  paragraphs: string[];
  cta?: { label: string; href: string };
  footer?: string;
}

function renderMailHtml(body: MailBodyOptions, brand: BrandConfig): string {
  const accent = brand.primaryColor;
  const accentInk = brand.primaryColorInk;
  const bg = brand.backgroundColor;
  const surface = brand.surfaceColor;
  const text = brand.textColor;
  const muted = brand.mutedTextColor;
  // accent-glow rgba derived from the hex — matches the convention
  // used by `renderBrandCss()` and the React-Email Barebone layout so
  // both surfaces visually agree.
  const accentGlow = hexToRgba(accent, 0.5);
  const cta = body.cta
    ? `<tr><td style="padding:12px 0 4px;">
         <a href="${body.cta.href}" style="display:inline-block;padding:12px 24px;border-radius:8px;background:${accent};color:${accentInk};text-decoration:none;font-weight:600;font-size:14px;letter-spacing:.01em;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${body.cta.label}</a>
       </td></tr>
       <tr><td style="padding:8px 0 4px;font-size:12px;color:${muted};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">If the button doesn't work, paste this URL into your browser:</td></tr>
       <tr><td style="padding:0 0 12px;font-size:12px;color:#a1a1aa;word-break:break-all;font-family:'SFMono-Regular',Menlo,Consolas,monospace;"><a href="${body.cta.href}" style="color:${accent};text-decoration:none;">${body.cta.href}</a></td></tr>`
    : "";
  const footer = body.footer
    ? `<tr><td style="padding:24px 0 0;border-top:1px solid rgba(255,255,255,0.06);font-size:12px;color:${muted};line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${body.footer}</td></tr>`
    : "";
  const paragraphs = body.paragraphs
    .map(
      (p) =>
        `<tr><td style="padding:0 0 14px;font-size:15px;line-height:1.65;color:${text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${p}</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 16px;background:${bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#ffffff;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="100%" style="max-width:560px;margin:0 auto;background:${surface};border:1px solid rgba(255,255,255,0.06);border-radius:14px;overflow:hidden;">
    <tr><td style="padding:24px 28px;border-bottom:1px solid rgba(255,255,255,0.06);">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td style="vertical-align:middle;font-size:16px;font-weight:600;color:#ffffff;letter-spacing:-0.01em;">
          <span style="display:inline-block;width:8px;height:8px;background:${accent};border-radius:999px;box-shadow:0 0 12px ${accentGlow};margin-right:8px;vertical-align:middle;"></span>
          <%= appName %>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:28px 28px 8px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr><td style="padding:0 0 14px;font-size:18px;font-weight:600;color:#ffffff;letter-spacing:-0.015em;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${body.greeting}</td></tr>
        ${paragraphs}
        ${cta}
        ${footer}
      </table>
    </td></tr>
    <tr><td style="padding:18px 28px;background:#0c0d11;font-size:11px;color:#52525b;text-align:center;letter-spacing:.04em;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      Sent by <%= appName %> · This is an automated message.
    </td></tr>
  </table>
</body></html>`;
}

function hexToRgba(hex: string, alpha: number): string {
  // Accepts the schema-validated #RRGGBB shape; falls back to the
  // brand default if a caller sneaks in a malformed value.
  const clean = hex.startsWith("#") ? hex.slice(1) : hex;
  if (clean.length !== 6) return `rgba(197, 251, 69, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function buildBuiltInEmailTemplateRegistry(
  brand: BrandConfig = defaultBrandConfig(),
): EmailTemplateRegistry {
  const reg = new InMemoryEmailTemplateRegistry();
  const accent = brand.primaryColor;

  reg.register("email-verification", null, {
    subject: "Please verify your email",
    html: renderMailHtml(
      {
        greeting: "Hello <%= recipientName %>,",
        paragraphs: [
          "Welcome to <%= appName %>! Please confirm this is your address so we know where to send important account updates.",
          "The verification link is valid for 24 hours. If you didn't sign up, you can safely ignore this email.",
        ],
        cta: { label: "Verify email", href: "<%= verificationUrl %>" },
      },
      brand,
    ),
    text:
      "Hello <%= recipientName %>,\n\n" +
      "Welcome to <%= appName %>! Please verify your email:\n<%= verificationUrl %>\n\n" +
      "The link is valid for 24 hours.",
  });

  reg.register("password-reset", null, {
    subject: "Reset your password",
    html: renderMailHtml(
      {
        greeting: "Hello <%= recipientName %>,",
        paragraphs: [
          "We received a request to reset your password. Click the button below to choose a new one.",
        ],
        cta: { label: "Reset password", href: "<%= resetUrl %>" },
        footer:
          "If you did not request a password reset, you can safely ignore this email — your password stays unchanged.",
      },
      brand,
    ),
    text:
      "Hello <%= recipientName %>,\n\n" +
      "Reset your password: <%= resetUrl %>\n\n" +
      "If you did not request this, ignore this email.",
  });

  reg.register("welcome", null, {
    subject: "Welcome to <%= appName %>",
    html: renderMailHtml(
      {
        greeting: "Hello <%= recipientName %>,",
        paragraphs: [
          "Welcome to <%= appName %>! Your account is ready to go.",
          "Reach out any time — we're glad to have you.",
        ],
      },
      brand,
    ),
    text: "Hello <%= recipientName %>,\n\nWelcome to <%= appName %>!\n\nYour account is ready to go.",
  });

  reg.register("invitation", null, {
    subject: "You have been invited to <%= appName %>",
    html: renderMailHtml(
      {
        greeting: "Hello <%= recipientName %>,",
        paragraphs: [
          `<strong style="color:${accent};"><%= senderName %></strong> has invited you to join <%= appName %>.`,
          "Accept the invitation to set up your account and start collaborating.",
        ],
        cta: { label: "Accept invitation", href: "<%= acceptUrl %>" },
        footer:
          "Invitations expire after 7 days. If you weren't expecting this, you can ignore the email.",
      },
      brand,
    ),
    text:
      "Hello <%= recipientName %>,\n\n" +
      "<%= senderName %> has invited you to join <%= appName %>.\n" +
      "Accept the invitation: <%= acceptUrl %>\n\n" +
      "Invitations expire after 7 days.",
  });

  return reg;
}
