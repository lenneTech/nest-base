import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * E2E · `pg_indexes` probes for cron-driven scan tables (iter-199).
 *
 * Iter-198's reviewer flagged G2: 4 cron-driven tables had load-bearing
 * indexes shipped via migration but no `pg_indexes` existence probe in
 * the test suite. Without the probe, a future schema-diff that drops
 * the index silently regresses the cron's hot-path scan from
 * O(log N) to O(N) without tripping any gate. This spec closes
 * that gap with a single suite that probes:
 *
 *   - `pending_erasures_eligible_idx` (GdprErasureRunner —
 *     leading-column lookup for `WHERE completed_at IS NULL`; the
 *     composite `(completed_at, cancelled_at, requested_at)` index
 *     also covers the runner's `requested_at < cutoff` ordering)
 *   - `email_outbox_status_next_attempt_at_idx`
 *     + `email_outbox_status_created_at_idx`
 *     (EmailOutboxWorker — `listDispatchable` orders by both
 *     status + nextAttemptAt branches)
 *   - `audit_log_tenant_id_created_at_idx`
 *     + `audit_log_target_model_target_id_idx`
 *     + `audit_log_actor_user_id_created_at_idx`
 *     (AdminSpaController.auditBrowserJson + AuditLog admin queries)
 *
 * Each probe is a single `SELECT indexname FROM pg_indexes WHERE
 * tablename = ... AND indexname = ...` + `expect(rows).toHaveLength(1)`
 * — same shape as the iter-181/iter-185/iter-197/iter-198 cleanup-cron
 * probes.
 *
 * Why one suite for 6 probes vs. 6 separate suites: the probes have
 * no test-order dependency, no isolation requirement (read-only), and
 * sharing a single `PrismaClient` connection avoids 5 testcontainer
 * connection-spin-up costs. The matching cleanup-cron e2e specs
 * (iter-181/185/197/198) exercise the cron's prune SQL semantics; this
 * spec fills the remaining "index-existence-only" probes.
 */
describe("E2E · Cron-driven table index probes (iter-199)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL required for the cron-table-indexes e2e suite");
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function probeIndex(tableName: string, indexName: string): Promise<void> {
    const result = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = $1 AND indexname = $2`,
      tableName,
      indexName,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.indexname).toBe(indexName);
  }

  it("`pending_erasures_eligible_idx` exists (GdprErasureRunner: WHERE completed_at IS NULL — leading-column lookup on the composite index)", async () => {
    await probeIndex("pending_erasures", "pending_erasures_eligible_idx");
  });

  it("`pending_erasures_user_id_idx` exists (lookup-by-user for GDPR self-service flows)", async () => {
    await probeIndex("pending_erasures", "pending_erasures_user_id_idx");
  });

  it("`email_outbox_status_next_attempt_at_idx` exists (EmailOutboxWorker.listDispatchable claim path)", async () => {
    await probeIndex("email_outbox", "email_outbox_status_next_attempt_at_idx");
  });

  it("`email_outbox_status_created_at_idx` exists (EmailOutboxWorker fallback claim path + lag query)", async () => {
    await probeIndex("email_outbox", "email_outbox_status_created_at_idx");
  });

  it("`audit_log_tenant_id_created_at_idx` exists (Audit Browser timeline pagination by tenant)", async () => {
    await probeIndex("audit_log", "audit_log_tenant_id_created_at_idx");
  });

  it("`audit_log_target_model_target_id_idx` exists (per-resource history lookup)", async () => {
    await probeIndex("audit_log", "audit_log_target_model_target_id_idx");
  });

  it("`audit_log_actor_user_id_created_at_idx` exists (per-actor audit trail filter)", async () => {
    await probeIndex("audit_log", "audit_log_actor_user_id_created_at_idx");
  });

  it("`api_keys_expires_at_idx` exists (iter-199 G1 closure — ApiKeyExpiryRunner daily cron)", async () => {
    // The CF.AUTH.17 `ApiKeyExpiryRunner` filters
    // `WHERE expires_at IS NOT NULL AND expires_at > NOW()` daily.
    // Migration `20260506180000_api_keys_expires_at` ships
    // `CREATE INDEX api_keys_expires_at_idx ON api_keys (expires_at)`
    // closing the parity gap with sister tables (`throttler_records`,
    // `idempotency_records`, `verifications`) that all carry their
    // matching `expires_at_idx`.
    await probeIndex("api_keys", "api_keys_expires_at_idx");
  });
});
