import { createHash } from "node:crypto";

/**
 * Pure planner for `bun run seed`.
 *
 * Produces the demo data shape the seed runner upserts via Prisma.
 * Two tenants × three users × role/membership rows give every
 * downstream slice (permission tester, story tests, manual playing-
 * around) a realistic starting point without each contributor
 * having to assemble fixtures by hand.
 *
 * Determinism: every id is derived from a stable seed string via
 * `seededUuidV7()` so the same input → the same output, every run.
 * That means the seed is idempotent: `upsert(id, ...)` matches the
 * existing row, no duplicates accumulate.
 *
 * Naming: emails are `<role>@<tenant-slug>.test` so a contributor
 * looking at a row can immediately tell which tenant + role it is.
 */

export interface SeedTenant {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
}

export interface SeedUser {
  id: string;
  email: string;
  tenantId: string;
  createdAt: Date;
}

export interface SeedTenantMember {
  id: string;
  userId: string;
  tenantId: string;
  role: "admin" | "member";
  status: "ACTIVE";
  joinedAt: Date;
  createdAt: Date;
}

export interface SeedPlan {
  tenants: SeedTenant[];
  users: SeedUser[];
  tenantMembers: SeedTenantMember[];
}

export interface SeedPlanInput {
  /** Override the wall-clock used for createdAt/joinedAt fields. */
  now?: Date;
}

interface TenantSpec {
  slug: string;
  name: string;
}

const TENANT_SPECS: TenantSpec[] = [
  { slug: "acme", name: "Acme Inc" },
  { slug: "globex", name: "Globex Corp" },
];

const ROLES_PER_TENANT: Array<{ role: "admin" | "member"; localPart: string }> = [
  { role: "admin", localPart: "admin" },
  { role: "member", localPart: "alice" },
  { role: "member", localPart: "bob" },
];

export function buildSeedPlan(input: SeedPlanInput = {}): SeedPlan {
  const now = input.now ?? new Date("2026-01-01T00:00:00Z");

  const tenants: SeedTenant[] = TENANT_SPECS.map((spec) => ({
    id: seededUuidV7(`tenant:${spec.slug}`, now),
    name: spec.name,
    slug: spec.slug,
    createdAt: now,
  }));

  const users: SeedUser[] = [];
  const tenantMembers: SeedTenantMember[] = [];

  for (const tenant of tenants) {
    for (const { role, localPart } of ROLES_PER_TENANT) {
      const userId = seededUuidV7(`user:${tenant.slug}:${localPart}`, now);
      users.push({
        id: userId,
        email: `${localPart}@${tenant.slug}.test`,
        tenantId: tenant.id,
        createdAt: now,
      });
      tenantMembers.push({
        id: seededUuidV7(`member:${tenant.slug}:${localPart}`, now),
        userId,
        tenantId: tenant.id,
        role,
        status: "ACTIVE",
        joinedAt: now,
        createdAt: now,
      });
    }
  }

  return { tenants, users, tenantMembers };
}

/**
 * Deterministic UUID v7 derived from a seed string. Real UUID v7 is
 * `<48 bit timestamp ms><4 bit version><12 bit rand_a><2 bit variant><62 bit rand_b>`.
 * For the seed we keep the timestamp from `now` (so generation order
 * matches a real run) and fill the random portions from a SHA-256 of
 * the seed key. This buys us:
 *   - well-formed UUID v7 (matches the regex /^[0-9a-f]{8}-[0-9a-f]{4}-...{12}$/)
 *   - reproducible across runs given the same key + now
 *   - sortable across the seed (timestamp prefix)
 */
function seededUuidV7(seedKey: string, now: Date): string {
  const ms = BigInt(now.getTime()) & 0xffffffffffffn; // 48 bits
  const tsHex = ms.toString(16).padStart(12, "0");
  const digest = sha256Hex(seedKey);
  // Bits 48-51 = version (`7`).
  const versionAndRandA = `7${digest.slice(0, 3)}`;
  // Bits 64-65 = variant (binary `10` ⇒ first nibble in {8, 9, a, b}).
  // Force first nibble of the third group to 'a'.
  const variantAndRandB = `a${digest.slice(3, 6)}`;
  const tail = digest.slice(6, 18);
  return `${tsHex.slice(0, 8)}-${tsHex.slice(8, 12)}-${versionAndRandA}-${variantAndRandB}-${tail}`;
}

function sha256Hex(input: string): string {
  // Synchronous hash is fine for a planner that runs once at seed time.
  return createHash("sha256").update(input).digest("hex");
}
