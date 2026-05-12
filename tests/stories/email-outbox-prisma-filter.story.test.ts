import { describe, expect, it, vi } from "vitest";

import { PrismaEmailOutboxStorage } from "../../src/core/email/email-outbox.prisma.js";
import { decodeCursor, encodeCursor } from "../../src/core/pagination/cursor.js";

/**
 * Story · PrismaEmailOutboxStorage.listFiltered — combined recipient+template filter.
 *
 * MEDIUM-6 fix: when both `recipient` and `template` are supplied, the old
 * code silently discarded the recipient filter (the template filter overwrote
 * `where.payload`). The fix composes both with `AND`.
 *
 * All assertions are on the WHERE clause passed to the mock Prisma client —
 * no real DB is needed.
 */
describe("Story · PrismaEmailOutboxStorage.listFiltered composes recipient+template with AND", () => {
  function makePrismaMock(rows: unknown[] = []) {
    return {
      emailOutbox: {
        findMany: vi.fn().mockResolvedValue(rows),
        count: vi.fn().mockResolvedValue(rows.length),
      },
    };
  }

  it("passes only recipient filter when only recipient is set", async () => {
    const prisma = makePrismaMock();
    const storage = new PrismaEmailOutboxStorage(prisma as never);
    await storage.listFiltered({ recipient: "alice@example.com" });
    const call = prisma.emailOutbox.findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(call.where).toMatchObject({
      payload: { path: ["to"], string_contains: "alice@example.com" },
    });
    expect(call.where).not.toHaveProperty("AND");
  });

  it("passes only template filter when only template is set", async () => {
    const prisma = makePrismaMock();
    const storage = new PrismaEmailOutboxStorage(prisma as never);
    await storage.listFiltered({ template: "welcome" });
    const call = prisma.emailOutbox.findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(call.where).toMatchObject({
      payload: { path: ["template"], equals: "welcome" },
    });
    expect(call.where).not.toHaveProperty("AND");
  });

  it("composes both filters with AND when both recipient and template are supplied", async () => {
    const prisma = makePrismaMock();
    const storage = new PrismaEmailOutboxStorage(prisma as never);
    await storage.listFiltered({ recipient: "bob@example.com", template: "password-reset" });
    const call = prisma.emailOutbox.findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    // Both filters must appear — neither is dropped.
    expect(call.where).toHaveProperty("AND");
    const andClauses = call.where["AND"] as Array<Record<string, unknown>>;
    expect(andClauses).toEqual(
      expect.arrayContaining([
        { payload: { path: ["to"], string_contains: "bob@example.com" } },
        { payload: { path: ["template"], equals: "password-reset" } },
      ]),
    );
  });
});

/**
 * Story · PrismaEmailOutboxStorage cursor pagination with sortBy=attempts.
 *
 * HIGH-1 fix: when sortBy="attempts", the cursor must encode attemptCount
 * (not createdAt.getTime()) and the cursor WHERE condition must seek by
 * attemptCount. Using createdAt for both directions caused duplicates/gaps
 * on page 2+ when paginating by attempts.
 */
describe("Story · PrismaEmailOutboxStorage cursor pagination with sortBy=attempts", () => {
  function makeRow(id: string, attemptCount: number) {
    return {
      id,
      kind: "SEND" as const,
      payload: {},
      idempotencyKey: null,
      status: "PENDING" as const,
      attemptCount,
      nextAttemptAt: null,
      claimedAt: null,
      lastError: null,
      succeededAt: null,
      failedAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    };
  }

  it("cursor encodes attemptCount (not createdAt) when sortBy=attempts", async () => {
    const row = makeRow("id-1", 5);
    const prisma = {
      emailOutbox: {
        // Return limit+1 rows so a nextCursor is generated.
        findMany: vi.fn().mockResolvedValue([row, makeRow("id-2", 3)]),
        count: vi.fn().mockResolvedValue(2),
      },
    };
    const storage = new PrismaEmailOutboxStorage(prisma as never);
    const result = await storage.listFiltered({ sortBy: "attempts", limit: 1 });
    expect(result.nextCursor).toBeDefined();
    const decoded = decodeCursor(result.nextCursor!);
    // The cursor's sortValue must equal the last item's attemptCount, not createdAt.
    expect(decoded.sortValue).toBe(row.attemptCount);
    expect(decoded.id).toBe(row.id);
  });

  it("cursor condition seeks by attemptCount (not createdAt) when sortBy=attempts", async () => {
    // Encode a cursor that carries an attemptCount sort value.
    const cursor = encodeCursor({ sortValue: 5, id: "id-1" });
    const prisma = {
      emailOutbox: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    };
    const storage = new PrismaEmailOutboxStorage(prisma as never);
    await storage.listFiltered({ sortBy: "attempts", cursor });
    const call = prisma.emailOutbox.findMany.mock.calls[0]?.[0] as {
      where: { AND?: Array<Record<string, unknown>> };
    };
    // The cursor condition must be in the AND array.
    expect(call.where).toHaveProperty("AND");
    const andClauses = call.where["AND"]!;
    // Find the clause that contains the OR cursor condition.
    const cursorClause = andClauses.find((c) => "OR" in c) as
      | { OR: Array<Record<string, unknown>> }
      | undefined;
    expect(cursorClause).toBeDefined();
    const orBranches = cursorClause!.OR;
    // First branch: attemptCount < sortValue (not createdAt).
    expect(orBranches[0]).toMatchObject({ attemptCount: { lt: 5 } });
    // Second branch: tie-break on id when attemptCount equals sortValue.
    expect(orBranches[1]).toMatchObject({ attemptCount: 5, id: { gt: "id-1" } });
  });
});
