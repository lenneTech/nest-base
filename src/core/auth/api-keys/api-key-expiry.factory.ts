import { Logger } from "@nestjs/common";

import { EmailService } from "../../email/email.service.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { ApiKeyExpiryRecord, ExpiryNotification } from "./api-key-expiry.notifier.js";
import type { ApiKeyExpiryRunnerInput } from "./api-key-expiry.runner.js";

const log = new Logger("ApiKeyExpiryRunnerFactory");

interface ApiKeyExpiryFactoryDeps {
  readonly prisma: PrismaService;
  readonly email: EmailService;
}

/**
 * Builds the production `ApiKeyExpiryRunnerInput` (CF.AUTH.17).
 *
 * Reader: `$queryRawUnsafe` against `api_keys` joined with `users`
 * (we side-step `prisma.apiKey.findMany` for the same Nest-IoC Proxy
 * reason iter-84 documented for the audit subsystem). Filters to
 * keys with a non-null `expires_at` whose value is in the future —
 * the planner does the per-key warn-window + cooldown evaluation.
 *
 * Notifier: `EmailService.sendTemplate({ template: "api-key-expiring", … })`
 * routed through the outbox by default (idempotency-key keyed on
 * `keyId + dayBucket` so a daily tick that fires twice within a few
 * seconds collapses to one row). The template is the iter-87
 * `api-key-expiring.tsx` React-Email file.
 *
 * Watermark: `UPDATE api_keys SET last_notified_at = NOW() WHERE id = $1`
 * via `$executeRaw`. The cron tick is idempotent — the planner's
 * cooldown filter prevents double-notifications even if the
 * watermark write races with a concurrent tick.
 *
 * Manage URL: `process.env.PUBLIC_BASE_URL ?? "http://localhost:3000"`
 * + `/dev/api-keys` so the email's CTA points at the project's
 * key-management page. Production deployments override
 * `PUBLIC_BASE_URL` in their environment.
 */
export function buildDefaultApiKeyExpiryRunnerInput(
  deps: ApiKeyExpiryFactoryDeps,
): ApiKeyExpiryRunnerInput {
  return {
    readKeys: () => readExpiringApiKeys(deps.prisma),
    sendNotification: (n) => sendExpiryEmail(deps, n),
    markNotified: (keyId, atMs) => markApiKeyNotified(deps.prisma, keyId, atMs),
  };
}

interface ApiKeyExpiryRow {
  readonly id: string;
  readonly user_id: string;
  readonly expires_at: Date | null;
  readonly last_notified_at: Date | null;
}

async function readExpiringApiKeys(prisma: PrismaService): Promise<readonly ApiKeyExpiryRecord[]> {
  // The planner re-evaluates warn-window + cooldown per key, so we
  // fetch every key whose expires_at is in the future. Volume is
  // bounded by active keys with an expiry — the index on (expires_at)
  // is the natural filter; falls back to a seq-scan on small tables.
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, user_id, expires_at, last_notified_at
       FROM api_keys
      WHERE expires_at IS NOT NULL
        AND expires_at > NOW()`,
  )) as ApiKeyExpiryRow[];
  return rows.map(
    (r): ApiKeyExpiryRecord => ({
      id: r.id,
      userId: r.user_id,
      expiresAt: r.expires_at ? r.expires_at.getTime() : null,
      lastNotifiedAt: r.last_notified_at ? r.last_notified_at.getTime() : null,
    }),
  );
}

async function sendExpiryEmail(
  deps: ApiKeyExpiryFactoryDeps,
  notification: ExpiryNotification,
): Promise<void> {
  // Look up the user's email + the key name. We could pre-join in
  // readExpiringApiKeys, but separating the read keeps the planner
  // shape minimal — the notifier hop is per-key and only fires for
  // keys the planner already accepted, so the extra round-trip is
  // bounded by the daily notification volume.
  const lookups = (await deps.prisma.$queryRawUnsafe(
    `SELECT u.email AS email, u.name AS recipient_name, k.name AS key_name
       FROM api_keys k
       JOIN users u ON u.id = k.user_id
      WHERE k.id = $1
      LIMIT 1`,
    notification.keyId,
  )) as Array<{ email: string; recipient_name: string | null; key_name: string }>;

  const row = lookups[0];
  if (!row) {
    log.warn(
      `apiKeyExpiry: cannot resolve user/key for keyId=${notification.keyId} — likely deleted between read and dispatch`,
    );
    return;
  }

  const expiresAtIso = new Date(notification.expiresAt).toISOString();
  const baseUrl = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
  const manageUrl = `${baseUrl.replace(/\/$/, "")}/dev/api-keys`;
  const appName = process.env.APP_NAME ?? "nest-base";

  // Idempotency-key collapses repeated dispatch attempts inside the
  // same UTC day to one outbox row — the cron is daily and the
  // cooldown filter normally suppresses repeats, but this is a
  // belt-and-braces guard for tick re-runs after a worker restart.
  const dayBucket = new Date(notification.expiresAt - notification.daysUntilExpiry * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const idempotencyKey = `api-key-expiring:${notification.keyId}:${dayBucket}`;

  await deps.email.sendTemplate(
    {
      to: row.email,
      template: "api-key-expiring",
      vars: {
        recipientName: row.recipient_name ?? row.email.split("@")[0] ?? "there",
        appName,
        keyName: row.key_name,
        daysUntilExpiry: notification.daysUntilExpiry,
        expiresAt: expiresAtIso,
        manageUrl,
      },
    },
    { mode: "outbox", idempotencyKey },
  );
}

async function markApiKeyNotified(
  prisma: PrismaService,
  keyId: string,
  atMs: number,
): Promise<void> {
  const ts = new Date(atMs).toISOString();
  await prisma.$executeRawUnsafe(
    `UPDATE api_keys SET last_notified_at = $1::timestamp WHERE id = $2::uuid`,
    ts,
    keyId,
  );
}
