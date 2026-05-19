import type { EmailOutboxPayload } from "./email-outbox.js";

export function outboxPayloadSummary(payload: EmailOutboxPayload): {
  recipient: string | null;
  template: string | null;
} {
  const recipient = "to" in payload && typeof payload.to === "string" ? payload.to : null;
  const template =
    "template" in payload && typeof payload.template === "string" ? payload.template : null;
  return { recipient, template };
}
