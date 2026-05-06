import { describe, expect, it } from "vitest";

/**
 * Story · Bootstrap-admin storage uses Prisma + Better-Auth (CF.SETUP.01
 * closure — iter-211).
 *
 * Iter-205's `docs/prd-deviations.md` documented CF.SETUP.01: the
 * `system-setup.module.ts` shipped an `InMemoryAdminStorage` Map
 * fake. The provisioning ran every boot but the Map was process-
 * local so re-provisioning happened on each cold start. The doc
 * comment was explicit: "Replaced with a Better-Auth-backed adapter
 * once Better-Auth's Prisma schema lands."
 *
 * Iter-211 closes the gap. `PrismaAdminProvisioningStorage` writes to
 * Better-Auth's `users` + `accounts` tables in a single transaction,
 * hashing the password via Better-Auth's canonical scrypt
 * `hashPassword`. The bootstrap admin row now survives restarts and
 * the existing-email idempotency check fires against the persisted
 * row.
 */
describe("Story · PrismaAdminProvisioningStorage (CF.SETUP.01 — iter-211)", () => {
  it("system-setup.module.ts no longer instantiates InMemoryAdminStorage as a provider", async () => {
    const { readFileSync } = await import("node:fs");
    const moduleSrc = readFileSync("src/core/setup/system-setup.module.ts", "utf8");
    // The historical reference survives in the doc-comment
    // ("The previous InMemoryAdminStorage..."), but the class itself
    // must not be a provider declaration anymore.
    expect(moduleSrc).not.toMatch(/class\s+InMemoryAdminStorage\s+implements/);
    expect(moduleSrc).not.toMatch(/useClass:\s*InMemoryAdminStorage/);
  });

  it("system-setup.module.ts wires PrismaAdminProvisioningStorage as the ADMIN_PROVISIONING_STORAGE provider", async () => {
    const { readFileSync } = await import("node:fs");
    const moduleSrc = readFileSync("src/core/setup/system-setup.module.ts", "utf8");
    expect(moduleSrc).toContain("PrismaAdminProvisioningStorage");
    expect(moduleSrc).toMatch(/useClass:\s*PrismaAdminProvisioningStorage/);
    expect(moduleSrc).toContain("PrismaModule");
  });

  it("PrismaAdminProvisioningStorage hashes passwords via Better-Auth scrypt + writes Account credentials", async () => {
    const { readFileSync } = await import("node:fs");
    const adapterSrc = readFileSync("src/core/setup/admin-storage.prisma.ts", "utf8");
    expect(adapterSrc).toContain('await import("better-auth/crypto")');
    expect(adapterSrc).toMatch(/hashPassword\(input\.password\)/);
    expect(adapterSrc).toMatch(/this\.prisma\.\$transaction/);
    expect(adapterSrc).toMatch(/tx\.user\.create/);
    expect(adapterSrc).toMatch(/tx\.account\.create/);
    expect(adapterSrc).toMatch(/providerId:\s*"credential"/);
  });

  it("PrismaAdminProvisioningStorage.findAdminByEmail queries the users table directly", async () => {
    const { readFileSync } = await import("node:fs");
    const adapterSrc = readFileSync("src/core/setup/admin-storage.prisma.ts", "utf8");
    expect(adapterSrc).toMatch(/this\.prisma\.user\.findFirst/);
    expect(adapterSrc).toMatch(/where:\s*\{\s*email\s*\}/);
  });

  it("docs/prd-deviations.md no longer lists CF.SETUP.01 — Bootstrap-admin provisioning storage", async () => {
    const { readFileSync } = await import("node:fs");
    const deviationsSrc = readFileSync("docs/prd-deviations.md", "utf8");
    expect(deviationsSrc).not.toMatch(/^### CF\.SETUP\.01/m);
  });
});
