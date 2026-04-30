/**
 * Process-wide singleton WebhookInspectorBuffer + CSRF secret.
 *
 * The buffer is intentionally a module-level singleton (matching
 * `log-buffer`, `query-buffer`, `trace-buffer`) so the dispatcher,
 * outbox subscriber, and admin controller all observe the same
 * delivery stream without injecting it everywhere. Tests reset the
 * buffer through `resetWebhookInspectorBufferForTests`.
 *
 * The CSRF secret is loaded once from `WEBHOOK_INSPECTOR_CSRF_SECRET`
 * with a randomly generated dev fallback. Production never reaches
 * the inspector controller (it 404s outside development) so a fresh
 * dev secret per process boot is acceptable.
 */

import { randomBytes } from "node:crypto";

import { WebhookInspectorBuffer } from "./inspector-store.js";

let buffer: WebhookInspectorBuffer = new WebhookInspectorBuffer();

export function getWebhookInspectorBuffer(): WebhookInspectorBuffer {
  return buffer;
}

export function resetWebhookInspectorBufferForTests(): void {
  buffer = new WebhookInspectorBuffer();
}

let csrfSecret: string | null = null;

export function getInspectorCsrfSecret(): string {
  if (csrfSecret !== null) return csrfSecret;
  const fromEnv = process.env.WEBHOOK_INSPECTOR_CSRF_SECRET;
  csrfSecret = fromEnv && fromEnv.length >= 16 ? fromEnv : randomBytes(32).toString("hex");
  return csrfSecret;
}

export function resetInspectorCsrfSecretForTests(): void {
  csrfSecret = null;
}
