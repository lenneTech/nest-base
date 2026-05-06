/**
 * Legacy `email-templates.ts` — entry-shape types kept after the
 * iter-68 EJS removal.
 *
 * The PRD's § Out of Scope explicitly bans EJS templates: "EJS
 * templates — React Email .tsx only". Iter-68 deleted the
 * homegrown EJS-subset renderer (`EjsEmailTemplateRenderer`),
 * the in-memory registry (`InMemoryEmailTemplateRegistry`), and
 * the built-in registry factory (`buildBuiltInEmailTemplateRegistry`).
 *
 * What remains is the small set of types that other modules still
 * use to describe an email-template entry:
 *   - `EmailTemplate`
 *   - `EmailTemplateRegistry`
 *   - `EmailTemplateNotFoundError`
 *   - `MissingTemplateVariableError`
 *
 * Production rendering happens through the React Email path
 * (`email-templates.react.ts > ReactEmailTemplateRenderer`) which
 * is the only renderer wired into `EmailModule` + `/dev/email-preview`
 * + the email-builder live preview.
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
