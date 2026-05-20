import type { EmailRenderedTemplate, EmailTemplateRenderer } from "../email/email.service.js";

/**
 * Pure planner for `/hub/email-preview`.
 *
 *   - `buildEmailPreviewCatalog()` enumerates every built-in template.
 *   - `renderEmailPreview()` composes one template + payload into
 *     subject / html / text. Wraps errors so the UI can show a
 *     degraded card instead of crashing the page.
 *
 * Preview payloads are resolved at request time via
 * `email-preview-payload-loader.ts` (outbox vars or brand appName).
 */

export interface EmailPreviewEntry {
  template: string;
  description: string;
}

export interface EmailPreviewCatalog {
  entries: EmailPreviewEntry[];
}

export interface BuildEmailPreviewCatalogOptions {
  /** Extra entries appended after the built-ins. */
  extras?: EmailPreviewEntry[];
}

export function buildEmailPreviewCatalog(
  extrasOrOptions: EmailPreviewEntry[] | BuildEmailPreviewCatalogOptions = [],
): EmailPreviewCatalog {
  const options: BuildEmailPreviewCatalogOptions = Array.isArray(extrasOrOptions)
    ? { extras: extrasOrOptions }
    : extrasOrOptions;
  const extras = options.extras ?? [];
  const builtIns: EmailPreviewEntry[] = [
    {
      template: "email-verification",
      description: "Sent after sign-up, asks the user to confirm their address.",
    },
    {
      template: "password-reset",
      description: "Sent when a user requests a password reset link.",
    },
    {
      template: "welcome",
      description: "Optional onboarding email after the first verified login.",
    },
    {
      template: "invitation",
      description: "Sent when an existing user invites someone to their tenant.",
    },
  ];
  return { entries: [...builtIns, ...extras] };
}

export interface EmailPreviewInput {
  renderer: EmailTemplateRenderer;
  template: string;
  locale: string;
  payload: Record<string, unknown>;
}

export interface EmailPreviewResult {
  subject?: string;
  html?: string;
  text?: string;
  error?: string;
}

export async function renderEmailPreview(input: EmailPreviewInput): Promise<EmailPreviewResult> {
  try {
    const rendered: EmailRenderedTemplate = await input.renderer.render(
      input.template,
      input.locale,
      input.payload,
    );
    return {
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
