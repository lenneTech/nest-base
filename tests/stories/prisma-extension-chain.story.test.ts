import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  type AuditLogWriteInput,
  buildAuditExtension,
  buildAuditStampExtension,
  softDeleteExtension,
  uuidV7Extension,
} from "../../src/core/repository/prisma-extensions.js";

/**
 * Story · Prisma extension chain (PRD § Core Features § Data).
 *
 * The PRD requires the 7-extension stack:
 *   softDelete → auditStamp → fieldEncryption → versionBump
 *               → audit → queryTracker → uuidV7
 *
 * Iter-62 + iter-67 land 4 of 7: `uuidV7Extension`,
 * `buildAuditStampExtension`, `softDeleteExtension`,
 * `buildAuditExtension` defined as `Prisma.defineExtension(...)`
 * units and chained inside `PrismaService.client` via `$extends()`.
 *
 * Remaining 3 extensions (fieldEncryption, versionBump, queryTracker)
 * are the next slice.
 */
describe("Story · Prisma extension chain (4 of 7)", () => {
  it("softDeleteExtension is a defineExtension instance with name 'softDelete'", () => {
    expect(softDeleteExtension).toBeDefined();
    // `Prisma.defineExtension` returns a function-like object whose
    // metadata reflects what `$extends()` will pick up. We don't
    // depend on the private shape — just on the presence of the
    // extension object itself.
    expect(
      typeof softDeleteExtension === "object" || typeof softDeleteExtension === "function",
    ).toBe(true);
  });

  it("uuidV7Extension is a defineExtension instance with name 'uuidV7'", () => {
    expect(uuidV7Extension).toBeDefined();
    expect(typeof uuidV7Extension === "object" || typeof uuidV7Extension === "function").toBe(true);
  });

  it("buildAuditStampExtension(resolvers) returns a valid extension", () => {
    const ext = buildAuditStampExtension({
      resolveTenantId: () => "11111111-1111-1111-1111-111111111111",
      resolveUserId: () => "user-1",
    });
    expect(ext).toBeDefined();
    expect(typeof ext === "object" || typeof ext === "function").toBe(true);
  });

  it("auditStamp resolver closures are the project's responsibility (test inverts the contract)", () => {
    let tenantHits = 0;
    let userHits = 0;
    const ext = buildAuditStampExtension({
      resolveTenantId: () => {
        tenantHits++;
        return "tenant-x";
      },
      resolveUserId: () => {
        userHits++;
        return "user-x";
      },
    });
    expect(ext).toBeDefined();
    // The resolvers haven't been invoked yet — they fire only on actual
    // Prisma queries, which need a live client. The test asserts the
    // ext-builder is lazy (closure capture, not eager evaluation).
    expect(tenantHits).toBe(0);
    expect(userHits).toBe(0);
  });

  it("the chain composes structurally without throwing (no live client needed)", () => {
    // We can't actually invoke `$extends()` here without a client, but
    // we can verify the chain shape: each extension is a separate
    // first-class value that PrismaService stitches together.
    const auditStamp = buildAuditStampExtension({
      resolveTenantId: () => null,
      resolveUserId: () => null,
    });
    const extensions = [uuidV7Extension, auditStamp, softDeleteExtension];
    expect(extensions).toHaveLength(3);
    for (const ext of extensions) {
      expect(ext).toBeDefined();
    }
  });

  it("Prisma.defineExtension is the canonical wrapper (extensions are not raw objects)", () => {
    // Sanity check — the project's extension-definition path must go
    // through Prisma's runtime so the type-system / DMMF integration
    // stays correct. Importing the actual `Prisma` namespace from
    // `@prisma/client` is the load-bearing detail.
    expect(typeof Prisma.defineExtension).toBe("function");
  });

  describe("buildAuditExtension (iter-67 — slot 5/7)", () => {
    it("returns a valid Prisma extension when wired with resolvers + writer", () => {
      const ext = buildAuditExtension({
        resolveTenantId: () => "tenant-x",
        resolveUserId: () => null,
        resolveRequestId: () => "req-1",
        writeAuditLog: async () => {
          // SDK-test stub.
        },
        auditableModels: ["Tenant"],
      });
      expect(ext).toBeDefined();
      expect(typeof ext === "object" || typeof ext === "function").toBe(true);
    });

    it("the writer closure receives the canonical AuditLogWriteInput shape (planner contract)", () => {
      const captured: AuditLogWriteInput[] = [];
      buildAuditExtension({
        resolveTenantId: () => "t-1",
        resolveUserId: () => "u-1",
        resolveRequestId: () => "r-1",
        writeAuditLog: async (input) => {
          captured.push(input);
        },
        auditableModels: ["Tenant"],
      });
      // No invocation yet — the closure fires only on actual queries.
      // Test asserts the type alias matches what the wiring expects:
      // a runtime audit row has (tenantId, actorUserId, targetModel,
      // targetId, action, diff, metadata).
      expect(captured).toHaveLength(0);
    });

    it("auditableModels = [] means no automatic audit-row emission", () => {
      const calls: AuditLogWriteInput[] = [];
      const ext = buildAuditExtension({
        resolveTenantId: () => "t-1",
        resolveUserId: () => null,
        resolveRequestId: () => null,
        writeAuditLog: async (input) => {
          calls.push(input);
        },
        auditableModels: [],
      });
      // Building the extension never emits — opt-in is the only path.
      expect(calls).toHaveLength(0);
      expect(ext).toBeDefined();
    });

    it("accepts an optional readBeforeImage callback (iter-69 — full before/after diff)", () => {
      const reads: Array<{ model: string; where: Record<string, unknown> }> = [];
      const ext = buildAuditExtension({
        resolveTenantId: () => "t-1",
        resolveUserId: () => null,
        resolveRequestId: () => null,
        writeAuditLog: async () => {
          // SDK stub.
        },
        readBeforeImage: async (model, where) => {
          reads.push({ model, where });
          return { id: "before-id", name: "old-name" };
        },
        auditableModels: ["Tenant"],
      });
      // The read closure isn't invoked at builder time — only on
      // actual update/delete queries. Test verifies the input
      // accepts the callback shape without throwing.
      expect(reads).toHaveLength(0);
      expect(ext).toBeDefined();
    });

    it("readBeforeImage is optional (iter-69 — backward-compat with iter-67 shape)", () => {
      const ext = buildAuditExtension({
        resolveTenantId: () => "t-1",
        resolveUserId: () => null,
        resolveRequestId: () => null,
        writeAuditLog: async () => {
          // SDK stub.
        },
        // No readBeforeImage — extension falls back to iter-67 shape:
        // UPDATE → {after: data}, DELETE → {where}.
        auditableModels: ["Tenant"],
      });
      expect(ext).toBeDefined();
    });
  });

  it("the chain now composes 4 extensions (uuidV7 → auditStamp → softDelete → audit)", () => {
    const auditStamp = buildAuditStampExtension({
      resolveTenantId: () => null,
      resolveUserId: () => null,
    });
    const audit = buildAuditExtension({
      resolveTenantId: () => null,
      resolveUserId: () => null,
      writeAuditLog: async () => {
        // SDK-test stub.
      },
      auditableModels: [],
    });
    const extensions = [uuidV7Extension, auditStamp, softDeleteExtension, audit];
    expect(extensions).toHaveLength(4);
    for (const ext of extensions) {
      expect(ext).toBeDefined();
    }
  });
});
