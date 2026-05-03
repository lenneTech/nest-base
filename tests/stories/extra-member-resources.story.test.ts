import { Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import type { DbPermissionRow } from "../../src/core/permissions/db-rule-resolver.js";
import {
  EXTRA_MEMBER_PER_USER_RESOURCES,
  EXTRA_MEMBER_RESOURCES,
} from "../../src/core/permissions/extra-resources.token.js";
import {
  DEFAULT_MEMBER_PER_USER_RESOURCES,
  DEFAULT_MEMBER_RESOURCES,
} from "../../src/core/permissions/member-role-rules.js";
import { PERMISSION_STORAGE } from "../../src/core/permissions/permission-storage.token.js";
import type { PermissionStorage } from "../../src/core/permissions/permission.service.js";
import { PermissionsModule } from "../../src/core/permissions/permissions.module.js";
import { PrismaPermissionStorage } from "../../src/core/permissions/prisma-permission-storage.js";

/**
 * Story · `EXTRA_MEMBER_RESOURCES` project-extension hook.
 *
 * Project modules need to grant the implicit Member role access to
 * project-owned resources WITHOUT editing template-owned code. Two
 * shapes compose:
 *
 *  - `EXTRA_MEMBER_RESOURCES` / `EXTRA_MEMBER_PER_USER_RESOURCES`
 *    DI tokens for a SINGLE override at the AppModule level.
 *  - `PermissionsModule.forFeature({ resources, perUserResources })`
 *    for module-level composition — multiple feature modules
 *    contribute independently and the storage flat-merges them.
 *
 * Why a `forFeature` helper plus single-override tokens (instead of
 * Angular-style `multi: true` providers): NestJS DI does not
 * aggregate `multi: true` registrations of the same token. The
 * helper plus token combination is the Nest-idiomatic equivalent.
 *
 * Tests use the storage directly with hand-built FakePrisma plus a
 * minimal NestJS `Test.createTestingModule` for the DI shapes; the
 * existing `prisma-permission-storage.story.test.ts` covers the
 * Postgres-backed default path.
 */

const TEST_USER_ID = "00000000-0000-7000-8000-00000000000a";
const TEST_TENANT_ID = "00000000-0000-7000-8000-00000000000b";

interface MemberStub {
  id: string;
  role: string;
}

interface FakePrismaSubset {
  tenantMember: {
    findFirst: (args: {
      where: { userId: string; tenantId: string; status: string };
      select: { id: true; role: true };
    }) => Promise<MemberStub | null>;
  };
  permission: {
    findMany: (args: unknown) => Promise<unknown[]>;
  };
}

function fakePrismaWithMember(): FakePrismaSubset {
  return {
    tenantMember: {
      async findFirst() {
        return { id: "m1", role: "member" };
      },
    },
    permission: {
      async findMany() {
        // No explicit Role/Policy/Permission rows — only synthesized
        // rules surface, which is exactly what we want to assert on.
        return [];
      },
    },
  };
}

function resourceNames(rows: DbPermissionRow[]): string[] {
  return rows.map((r) => r.resource);
}

describe("Story · EXTRA_MEMBER_RESOURCES project-extension hook", () => {
  it("emits ONLY DEFAULT_MEMBER_RESOURCES + DEFAULT_MEMBER_PER_USER_RESOURCES when no extras are provided", async () => {
    const storage = new PrismaPermissionStorage(
      fakePrismaWithMember() as unknown as ConstructorParameters<typeof PrismaPermissionStorage>[0],
    );
    const rows = await storage.findRulesForUser(TEST_USER_ID, TEST_TENANT_ID);
    const names = resourceNames(rows);

    expect(names.sort()).toEqual(
      [...DEFAULT_MEMBER_RESOURCES, ...DEFAULT_MEMBER_PER_USER_RESOURCES].sort(),
    );
  });

  it("adds a tenant-scoped 'manage' rule when one extra resource is provided", async () => {
    const storage = new PrismaPermissionStorage(
      fakePrismaWithMember() as unknown as ConstructorParameters<typeof PrismaPermissionStorage>[0],
      {},
      { extraTenantResources: [["Todo"]] },
    );
    const rows = await storage.findRulesForUser(TEST_USER_ID, TEST_TENANT_ID);
    const todo = rows.find((r) => r.resource === "Todo");

    expect(todo).toBeDefined();
    expect(todo?.action).toBe("MANAGE");
    expect(todo?.itemFilter).toEqual({ tenantId: { _eq: "$CURRENT_TENANT" } });
    expect(todo?.fields).toEqual([]);
  });

  it("flat-maps multiple forFeature contributions — both resources show up", async () => {
    @Module({ imports: [PermissionsModule.forFeature({ resources: ["Todo"] })] })
    class TodoModule {}

    @Module({ imports: [PermissionsModule.forFeature({ resources: ["Invoice"] })] })
    class InvoiceModule {}

    const module = await Test.createTestingModule({
      imports: [PermissionsModule, TodoModule, InvoiceModule],
    }).compile();

    // After module init the aggregated extras hold both contributions
    // (one inner array per forFeature).
    const tenantExtras = module.get<readonly (readonly string[])[]>(EXTRA_MEMBER_RESOURCES);
    const flat = tenantExtras.flat();
    expect(flat).toContain("Todo");
    expect(flat).toContain("Invoice");
    await module.close();
  });

  it("scopes per-user extras with $CURRENT_USER, not $CURRENT_TENANT", async () => {
    const storage = new PrismaPermissionStorage(
      fakePrismaWithMember() as unknown as ConstructorParameters<typeof PrismaPermissionStorage>[0],
      {},
      { extraUserResources: [["UserNote"]] },
    );

    const rows = await storage.findRulesForUser(TEST_USER_ID, TEST_TENANT_ID);
    const userNote = rows.find((r) => r.resource === "UserNote");

    expect(userNote).toBeDefined();
    expect(userNote?.itemFilter).toEqual({ userId: { _eq: "$CURRENT_USER" } });
  });

  it("dedupes when two contributions list the same extra (Todo appears once)", async () => {
    const storage = new PrismaPermissionStorage(
      fakePrismaWithMember() as unknown as ConstructorParameters<typeof PrismaPermissionStorage>[0],
      {},
      { extraTenantResources: [["Todo"], ["Todo", "Invoice"]] },
    );
    const rows = await storage.findRulesForUser(TEST_USER_ID, TEST_TENANT_ID);
    const todoRows = rows.filter((r) => r.resource === "Todo");
    const invoiceRows = rows.filter((r) => r.resource === "Invoice");

    expect(todoRows).toHaveLength(1);
    expect(invoiceRows).toHaveLength(1);
  });

  it("empty defaults override + empty extras → only per-user rules remain", async () => {
    // Defense in depth: a project that overrides resources to []
    // should still see its perUser defaults (here also overridden to
    // []) — and emerge with zero rules. Proves the flat-map / merge
    // does not "rescue" extras into the wrong bucket.
    const storage = new PrismaPermissionStorage(
      fakePrismaWithMember() as unknown as ConstructorParameters<typeof PrismaPermissionStorage>[0],
      { memberResources: [], memberPerUserResources: [] },
      { extraTenantResources: [], extraUserResources: [] },
    );

    const rows = await storage.findRulesForUser(TEST_USER_ID, TEST_TENANT_ID);
    expect(rows).toEqual([]);
  });

  it("when the resources override is set to [], extras still merge in (no defaults)", async () => {
    // Project test fixture pattern: override defaults to a minimal
    // catalogue but still keep the EXTRA_* hook composable.
    const storage = new PrismaPermissionStorage(
      fakePrismaWithMember() as unknown as ConstructorParameters<typeof PrismaPermissionStorage>[0],
      { memberResources: [], memberPerUserResources: [] },
      { extraTenantResources: [["Todo"]], extraUserResources: [["UserNote"]] },
    );

    const rows = await storage.findRulesForUser(TEST_USER_ID, TEST_TENANT_ID);
    const names = resourceNames(rows).sort();
    expect(names).toEqual(["Todo", "UserNote"]);
    const todo = rows.find((r) => r.resource === "Todo");
    const userNote = rows.find((r) => r.resource === "UserNote");
    expect(todo?.itemFilter).toEqual({ tenantId: { _eq: "$CURRENT_TENANT" } });
    expect(userNote?.itemFilter).toEqual({ userId: { _eq: "$CURRENT_USER" } });
  });

  it("PermissionsModule provides empty defaults for both EXTRA_* tokens — consumers don't have to provide them", async () => {
    // Smoke check: a consumer that imports PermissionsModule and never
    // contributes via forFeature still gets working defaults. The
    // values below are what the module emits when no project module
    // contributes.
    const module = await Test.createTestingModule({ imports: [PermissionsModule] }).compile();
    const tenantExtras = module.get<readonly (readonly string[])[]>(EXTRA_MEMBER_RESOURCES);
    const userExtras = module.get<readonly (readonly string[])[]>(EXTRA_MEMBER_PER_USER_RESOURCES);
    expect(Array.isArray(tenantExtras)).toBe(true);
    expect(Array.isArray(userExtras)).toBe(true);
    // No forFeature contributions yet → empty aggregated lists.
    expect(tenantExtras.flat()).toEqual([]);
    expect(userExtras.flat()).toEqual([]);
    await module.close();
  });

  it("preserves insertion order: defaults first, then extras (no global alphabetical sort)", async () => {
    // The existing `member-role-rules.story.test.ts` does NOT depend on
    // an alphabetical order, but other CASL-rule consumers might. We
    // pin a determinism contract here so future refactors don't shuffle
    // the list silently.
    const storage = new PrismaPermissionStorage(
      fakePrismaWithMember() as unknown as ConstructorParameters<typeof PrismaPermissionStorage>[0],
      {},
      { extraTenantResources: [["ZZZTodo", "AAAInvoice"]] },
    );
    const rows = await storage.findRulesForUser(TEST_USER_ID, TEST_TENANT_ID);
    const tenantNames = rows
      .filter((r) => r.itemFilter && "tenantId" in (r.itemFilter as Record<string, unknown>))
      .map((r) => r.resource);

    // First N entries are the verbatim DEFAULT_MEMBER_RESOURCES order.
    expect(tenantNames.slice(0, DEFAULT_MEMBER_RESOURCES.length)).toEqual([
      ...DEFAULT_MEMBER_RESOURCES,
    ]);
    // Extras follow, stable-sorted (so two equal-input runs match).
    const extras = tenantNames.slice(DEFAULT_MEMBER_RESOURCES.length);
    expect([...extras].sort()).toEqual(extras);
  });

  it("a forFeature contribution surfaces in the synthesized rules at runtime", async () => {
    // End-to-end: register Todo via forFeature, then call into the
    // wired PERMISSION_STORAGE — Todo must be one of the synthesized
    // tenant-scoped subjects.
    @Module({
      imports: [
        PermissionsModule.forFeature({
          resources: ["Todo"],
          perUserResources: ["UserNote"],
        }),
      ],
    })
    class TodoModule {}

    const module = await Test.createTestingModule({
      imports: [PermissionsModule, TodoModule],
    })
      // overrideProvider so the prod PrismaService dependency is
      // skipped — the fake storage is what we want to assert against.
      .overrideProvider(PERMISSION_STORAGE)
      .useFactory({
        factory: (
          extraTenant: readonly (readonly string[])[],
          extraUser: readonly (readonly string[])[],
        ): PermissionStorage =>
          new PrismaPermissionStorage(
            fakePrismaWithMember() as unknown as ConstructorParameters<
              typeof PrismaPermissionStorage
            >[0],
            {},
            { extraTenantResources: extraTenant, extraUserResources: extraUser },
          ),
        inject: [EXTRA_MEMBER_RESOURCES, EXTRA_MEMBER_PER_USER_RESOURCES],
      })
      .compile();

    const storage = module.get<PermissionStorage>(PERMISSION_STORAGE);
    const rows = await storage.findRulesForUser(TEST_USER_ID, TEST_TENANT_ID);
    const tenantSubjects = new Set(
      rows
        .filter((r) => r.itemFilter && "tenantId" in (r.itemFilter as Record<string, unknown>))
        .map((r) => r.resource),
    );
    const userSubjects = new Set(
      rows
        .filter((r) => r.itemFilter && "userId" in (r.itemFilter as Record<string, unknown>))
        .map((r) => r.resource),
    );
    expect(tenantSubjects.has("Todo")).toBe(true);
    expect(userSubjects.has("UserNote")).toBe(true);
    await module.close();
  });
});
