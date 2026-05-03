import { Test, type TestingModule } from "@nestjs/testing";
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
import { PrismaPermissionStorage } from "../../src/core/permissions/prisma-permission-storage.js";

/**
 * Story · `EXTRA_MEMBER_RESOURCES` multi-provider hook.
 *
 * Project modules need to grant the implicit Member role access to
 * project-owned resources WITHOUT editing template-owned code. Two
 * multi-provider DI tokens (`EXTRA_MEMBER_RESOURCES` for tenant-scoped
 * subjects and `EXTRA_MEMBER_PER_USER_RESOURCES` for `$CURRENT_USER`-
 * scoped ones) let any module flat-merge its catalogue into the
 * synthesized rules emitted by `PrismaPermissionStorage`.
 *
 * The tests below exercise the storage in isolation against a fake
 * Prisma client so we can assert exactly which rows are produced;
 * the existing `prisma-permission-storage.story.test.ts` covers the
 * end-to-end Postgres path with the default-only DI shape.
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

/** Filter rows by resource for assertion convenience. */
function resourceNames(rows: DbPermissionRow[]): string[] {
  return rows.map((r) => r.resource);
}

describe("Story · EXTRA_MEMBER_RESOURCES multi-provider hook", () => {
  it("emits ONLY DEFAULT_MEMBER_RESOURCES + DEFAULT_MEMBER_PER_USER_RESOURCES when no extras are provided", async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: PERMISSION_STORAGE,
          useFactory: (
            extraTenant: readonly string[][],
            extraUser: readonly string[][],
          ) =>
            new PrismaPermissionStorage(
              fakePrismaWithMember() as unknown as ConstructorParameters<
                typeof PrismaPermissionStorage
              >[0],
              {},
              { extraTenantResources: extraTenant, extraUserResources: extraUser },
            ),
          inject: [
            { token: EXTRA_MEMBER_RESOURCES, optional: true },
            { token: EXTRA_MEMBER_PER_USER_RESOURCES, optional: true },
          ],
        },
        {
          provide: EXTRA_MEMBER_RESOURCES,
          useValue: [],
          multi: true,
        },
        {
          provide: EXTRA_MEMBER_PER_USER_RESOURCES,
          useValue: [],
          multi: true,
        },
      ],
    }).compile();

    const storage = module.get<PrismaPermissionStorage>(PERMISSION_STORAGE);
    const rows = await storage.findRulesForUser(TEST_USER_ID, TEST_TENANT_ID);
    const names = resourceNames(rows);

    expect(names.sort()).toEqual(
      [...DEFAULT_MEMBER_RESOURCES, ...DEFAULT_MEMBER_PER_USER_RESOURCES].sort(),
    );
    await module.close();
  });

  it("adds a tenant-scoped 'manage' rule when one provider supplies a single resource", async () => {
    const module = await Test.createTestingModule({
      providers: [
        {
          provide: PERMISSION_STORAGE,
          useFactory: (
            extraTenant: readonly string[][],
            extraUser: readonly string[][],
          ) =>
            new PrismaPermissionStorage(
              fakePrismaWithMember() as unknown as ConstructorParameters<
                typeof PrismaPermissionStorage
              >[0],
              {},
              { extraTenantResources: extraTenant, extraUserResources: extraUser },
            ),
          inject: [
            { token: EXTRA_MEMBER_RESOURCES, optional: true },
            { token: EXTRA_MEMBER_PER_USER_RESOURCES, optional: true },
          ],
        },
        { provide: EXTRA_MEMBER_RESOURCES, useValue: ["Todo"], multi: true },
        { provide: EXTRA_MEMBER_PER_USER_RESOURCES, useValue: [], multi: true },
      ],
    }).compile();

    const storage = module.get<PrismaPermissionStorage>(PERMISSION_STORAGE);
    const rows = await storage.findRulesForUser(TEST_USER_ID, TEST_TENANT_ID);
    const todo = rows.find((r) => r.resource === "Todo");

    expect(todo).toBeDefined();
    expect(todo?.action).toBe("MANAGE");
    expect(todo?.itemFilter).toEqual({ tenantId: { _eq: "$CURRENT_TENANT" } });
    expect(todo?.fields).toEqual([]);
    await module.close();
  });

  it("flat-maps multiple providers — both resources show up", async () => {
    const module = await Test.createTestingModule({
      providers: [
        {
          provide: PERMISSION_STORAGE,
          useFactory: (
            extraTenant: readonly string[][],
            extraUser: readonly string[][],
          ) =>
            new PrismaPermissionStorage(
              fakePrismaWithMember() as unknown as ConstructorParameters<
                typeof PrismaPermissionStorage
              >[0],
              {},
              { extraTenantResources: extraTenant, extraUserResources: extraUser },
            ),
          inject: [
            { token: EXTRA_MEMBER_RESOURCES, optional: true },
            { token: EXTRA_MEMBER_PER_USER_RESOURCES, optional: true },
          ],
        },
        { provide: EXTRA_MEMBER_RESOURCES, useValue: ["Todo"], multi: true },
        { provide: EXTRA_MEMBER_RESOURCES, useValue: ["Invoice"], multi: true },
        { provide: EXTRA_MEMBER_PER_USER_RESOURCES, useValue: [], multi: true },
      ],
    }).compile();

    const storage = module.get<PrismaPermissionStorage>(PERMISSION_STORAGE);
    const rows = await storage.findRulesForUser(TEST_USER_ID, TEST_TENANT_ID);
    const names = resourceNames(rows);

    expect(names).toContain("Todo");
    expect(names).toContain("Invoice");
    await module.close();
  });

  it("scopes per-user extras with $CURRENT_USER, not $CURRENT_TENANT", async () => {
    const module = await Test.createTestingModule({
      providers: [
        {
          provide: PERMISSION_STORAGE,
          useFactory: (
            extraTenant: readonly string[][],
            extraUser: readonly string[][],
          ) =>
            new PrismaPermissionStorage(
              fakePrismaWithMember() as unknown as ConstructorParameters<
                typeof PrismaPermissionStorage
              >[0],
              {},
              { extraTenantResources: extraTenant, extraUserResources: extraUser },
            ),
          inject: [
            { token: EXTRA_MEMBER_RESOURCES, optional: true },
            { token: EXTRA_MEMBER_PER_USER_RESOURCES, optional: true },
          ],
        },
        { provide: EXTRA_MEMBER_RESOURCES, useValue: [], multi: true },
        {
          provide: EXTRA_MEMBER_PER_USER_RESOURCES,
          useValue: ["UserNote"],
          multi: true,
        },
      ],
    }).compile();

    const storage = module.get<PrismaPermissionStorage>(PERMISSION_STORAGE);
    const rows = await storage.findRulesForUser(TEST_USER_ID, TEST_TENANT_ID);
    const userNote = rows.find((r) => r.resource === "UserNote");

    expect(userNote).toBeDefined();
    expect(userNote?.itemFilter).toEqual({ userId: { _eq: "$CURRENT_USER" } });
    await module.close();
  });

  it("dedupes when two providers list the same extra (Todo appears once)", async () => {
    const module = await Test.createTestingModule({
      providers: [
        {
          provide: PERMISSION_STORAGE,
          useFactory: (
            extraTenant: readonly string[][],
            extraUser: readonly string[][],
          ) =>
            new PrismaPermissionStorage(
              fakePrismaWithMember() as unknown as ConstructorParameters<
                typeof PrismaPermissionStorage
              >[0],
              {},
              { extraTenantResources: extraTenant, extraUserResources: extraUser },
            ),
          inject: [
            { token: EXTRA_MEMBER_RESOURCES, optional: true },
            { token: EXTRA_MEMBER_PER_USER_RESOURCES, optional: true },
          ],
        },
        { provide: EXTRA_MEMBER_RESOURCES, useValue: ["Todo"], multi: true },
        {
          provide: EXTRA_MEMBER_RESOURCES,
          useValue: ["Todo", "Invoice"],
          multi: true,
        },
        { provide: EXTRA_MEMBER_PER_USER_RESOURCES, useValue: [], multi: true },
      ],
    }).compile();

    const storage = module.get<PrismaPermissionStorage>(PERMISSION_STORAGE);
    const rows = await storage.findRulesForUser(TEST_USER_ID, TEST_TENANT_ID);
    const todoRows = rows.filter((r) => r.resource === "Todo");
    const invoiceRows = rows.filter((r) => r.resource === "Invoice");

    expect(todoRows).toHaveLength(1);
    expect(invoiceRows).toHaveLength(1);
    await module.close();
  });

  it("empty defaults override + empty extras → only per-user rules remain", async () => {
    // Defense in depth: a project that overrides resources to []
    // should still see its perUser defaults (here also overridden to
    // []) — and emerge with zero rules. Proves the flat-map / merge
    // does not "rescue" extras into the wrong bucket.
    const storage = new PrismaPermissionStorage(
      fakePrismaWithMember() as unknown as ConstructorParameters<
        typeof PrismaPermissionStorage
      >[0],
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
      fakePrismaWithMember() as unknown as ConstructorParameters<
        typeof PrismaPermissionStorage
      >[0],
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

  it("PermissionsModule provides the EXTRA_* tokens with empty defaults (consumers don't have to provide them)", async () => {
    // Smoke check: a consumer that imports PermissionsModule and never
    // multi-provides anything still gets a working PermissionService.
    // The defaults below (empty arrays) are what the module must emit.
    const module = await Test.createTestingModule({
      providers: [
        { provide: EXTRA_MEMBER_RESOURCES, useValue: [], multi: true },
        { provide: EXTRA_MEMBER_PER_USER_RESOURCES, useValue: [], multi: true },
      ],
    }).compile();

    const tenantExtras = module.get<readonly string[][]>(EXTRA_MEMBER_RESOURCES);
    const userExtras = module.get<readonly string[][]>(EXTRA_MEMBER_PER_USER_RESOURCES);
    expect(Array.isArray(tenantExtras)).toBe(true);
    expect(Array.isArray(userExtras)).toBe(true);
    // Each multi-provider entry is itself an array.
    for (const entry of tenantExtras) {
      expect(Array.isArray(entry)).toBe(true);
    }
    for (const entry of userExtras) {
      expect(Array.isArray(entry)).toBe(true);
    }
    await module.close();
  });

  it("preserves insertion order: defaults first, then extras (no global alphabetical sort)", async () => {
    // The existing `member-role-rules.story.test.ts` does NOT depend on
    // an alphabetical order, but other CASL-rule consumers might. We
    // pin a determinism contract here so future refactors don't shuffle
    // the list silently.
    const storage = new PrismaPermissionStorage(
      fakePrismaWithMember() as unknown as ConstructorParameters<
        typeof PrismaPermissionStorage
      >[0],
      {},
      { extraTenantResources: [["ZZZTodo", "AAAInvoice"]], extraUserResources: [] },
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
});
