import { describe, expect, it } from "vitest";

/**
 * Story · UUID v7 schema defaults (CF.UUID.01 deviation closure —
 * iter-210).
 *
 * Iter-205's `docs/prd-deviations.md` documented CF.UUID.01: every
 * model in `prisma/schema.prisma` declared `@default(uuid())` (Prisma
 * UUID v4 generated client-side) even though the `uuidV7Extension`
 * intercepted writes to inject a v7 id at runtime. The mismatch was
 * a documentation/mental-model issue: readers saw v4 in the schema,
 * production wrote v7, and raw-SQL inserts that bypassed the Prisma
 * client got NO default at all.
 *
 * Iter-210 closes the gap. Every core-schema model now declares
 * `@default(dbgenerated("uuid_generate_v7()"))` and a matching
 * migration `20260506210000_uuid_v7_defaults_core` sets the
 * Postgres-side `DEFAULT uuid_generate_v7()` on every id column. The
 * `pg_uuidv7` extension is enabled by the early base migration so
 * the function is always available. `idempotency_records` and
 * `asset_variant_index` use string-typed PKs (`key` / `cache_key`)
 * and are intentionally excluded.
 */
describe("Story · UUID v7 schema defaults (CF.UUID.01 — iter-210)", () => {
  it("schema.prisma has zero `@default(uuid())` occurrences (all flipped to v7)", async () => {
    const { readFileSync } = await import("node:fs");
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    expect(schema).not.toMatch(/@default\(uuid\(\)\)/);
  });

  it('schema.prisma uses `@default(dbgenerated("uuid_generate_v7()"))` on every id column', async () => {
    const { readFileSync } = await import("node:fs");
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const v7Count = (schema.match(/dbgenerated\("uuid_generate_v7\(\)"\)/g) ?? []).length;
    // 25 id-bearing models in the core schema (HealthPing, Tenant,
    // TenantMember, User, Session, Account, Verification, Jwks,
    // TwoFactor, Passkey, ApiKey, FileBlob, Folder, File,
    // WebhookEndpoint, WebhookDelivery, EmailOutbox, Role, Policy,
    // Permission, Example, UserProfile, OutboxEntry, PendingErasure,
    // AuditLog).
    expect(v7Count).toBeGreaterThanOrEqual(25);
  });

  it("the migration file `20260506210000_uuid_v7_defaults_core` exists and ALTERs every id column", async () => {
    const { readFileSync } = await import("node:fs");
    const migration = readFileSync(
      "prisma/migrations/20260506210000_uuid_v7_defaults_core/migration.sql",
      "utf8",
    );
    // Spot-check a representative subset spanning core, auth,
    // permissions, files, webhooks, email, outbox, gdpr, audit.
    const required = [
      "tenants",
      "users",
      "sessions",
      "accounts",
      "api_keys",
      "files",
      "roles",
      "permissions",
      "webhook_endpoints",
      "email_outbox",
      "outbox_entries",
      "pending_erasures",
      "audit_log",
    ];
    for (const table of required) {
      expect(migration).toMatch(
        new RegExp(
          `ALTER TABLE\\s+"${table}"\\s+ALTER COLUMN\\s+"id"\\s+SET DEFAULT uuid_generate_v7\\(\\)`,
        ),
      );
    }
  });

  it("idempotency_records and asset_variant_index are intentionally excluded (string PKs)", async () => {
    const { readFileSync } = await import("node:fs");
    const migration = readFileSync(
      "prisma/migrations/20260506210000_uuid_v7_defaults_core/migration.sql",
      "utf8",
    );
    expect(migration).not.toMatch(/ALTER TABLE\s+"idempotency_records"\s+ALTER COLUMN\s+"id"/);
    expect(migration).not.toMatch(/ALTER TABLE\s+"asset_variant_index"\s+ALTER COLUMN\s+"id"/);
  });

  it("docs/prd-deviations.md no longer lists CF.UUID.01 — UUID v7 schema migration", async () => {
    const { readFileSync } = await import("node:fs");
    const deviationsSrc = readFileSync("docs/prd-deviations.md", "utf8");
    expect(deviationsSrc).not.toMatch(/^### CF\.UUID\.01/m);
  });
});
