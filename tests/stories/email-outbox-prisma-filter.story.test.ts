import { describe, expect, it, vi } from "vitest";

import { PrismaEmailOutboxStorage } from "../../src/core/email/email-outbox.prisma.js";

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
