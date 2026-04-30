import type { EmailRenderedTemplate, EmailTemplateRenderer } from "../email/email.service.js";

/**
 * Pure planner for `/dev/email-preview`.
 *
 * Two pieces:
 *
 *   - `buildEmailPreviewCatalog()` enumerates every built-in
 *     template + a realistic sample payload. The dev-hub page
 *     iterates this list and gives each template a card.
 *   - `renderEmailPreview()` composes one template + payload into
 *     the rendered subject / html / text. Wraps errors so the UI can
 *     show a degraded card instead of crashing the page.
 *
 * The catalog is hard-coded against the four built-in templates from
 * `buildBuiltInEmailTemplateRegistry()`. Downstream projects that
 * register more templates can extend the list — `extras` parameter.
 */

export interface EmailPreviewEntry {
  template: string;
  description: string;
  samplePayload: Record<string, string>;
}

export interface EmailPreviewCatalog {
  entries: EmailPreviewEntry[];
}

export interface BuildEmailPreviewCatalogOptions {
  /** Extra entries appended after the built-ins. */
  extras?: EmailPreviewEntry[];
  /** AppName used in every sample payload — defaults to "nest-base". */
  appName?: string;
}

export function buildEmailPreviewCatalog(
  extrasOrOptions: EmailPreviewEntry[] | BuildEmailPreviewCatalogOptions = [],
): EmailPreviewCatalog {
  // Backwards-compatible signature: callers may pass a plain array (the
  // pre-issue-#5 shape) or an options bag. Inspect the input shape so
  // existing call sites keep working without a touch-up.
  const options: BuildEmailPreviewCatalogOptions = Array.isArray(extrasOrOptions)
    ? { extras: extrasOrOptions }
    : extrasOrOptions;
  const appName = options.appName ?? "nest-base";
  const extras = options.extras ?? [];
  const builtIns: EmailPreviewEntry[] = [
    {
      template: "email-verification",
      description: "Sent after sign-up, asks the user to confirm their address.",
      samplePayload: {
        recipientName: "Alice Example",
        appName,
        verificationUrl: "https://app.example.test/verify?token=preview",
      },
    },
    {
      template: "password-reset",
      description: "Sent when a user requests a password reset link.",
      samplePayload: {
        recipientName: "Alice Example",
        appName,
        resetUrl: "https://app.example.test/reset?token=preview",
      },
    },
    {
      template: "welcome",
      description: "Optional onboarding email after the first verified login.",
      samplePayload: {
        recipientName: "Alice Example",
        appName,
      },
    },
    {
      template: "invitation",
      description: "Sent when an existing user invites someone to their tenant.",
      samplePayload: {
        recipientName: "Bob Newcomer",
        senderName: "Alice Example",
        appName,
        acceptUrl: "https://app.example.test/invitations/preview/accept",
      },
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
