import { beforeEach, describe, expect, it } from "vitest";

import { createFakePrisma, type FakePrismaService } from "../lib/fake-prisma.js";

/**
 * Story · `FakePrisma` pagination (friction-log #9).
 *
 * The fake originally ignored `skip` / `take` and didn't expose
 * `count`. Pushing `skip`/`take` to the fake silently returned ALL
 * rows — every story test for `page+limit` pagination passed
 * vacuously. Real Prisma + Postgres honour both, so the fake's
 * behaviour drifted away from production.
 *
 * Two new contracts:
 *   1. `findMany({ skip, take })` honours both AFTER `where` + `orderBy`,
 *      with `skip` defaulting to 0 and `take` to Infinity.
 *   2. `count({ where })` returns the number of rows that match the
 *      filter (without any pagination slicing).
 *
 * Existing single-`OrderBy` semantics stay untouched — the array form
 * already works and is the place to add tie-breakers when the schema
 * needs them.
 */
describe("Story · FakePrisma pagination (skip / take / count)", () => {
  let fake: FakePrismaService;

  beforeEach(() => {
    fake = createFakePrisma();
  });

  it("honours `skip` and `take` after where+orderBy and exposes `count`", async () => {
    const dynamic = fake as unknown as Record<
      string,
      ReturnType<typeof createFakePrisma>["example"] & {
        count(input?: { where?: Record<string, unknown> }): Promise<number>;
      }
    >;

    // 5 rows in the same tenant — assert page-2-of-2 returns the
    // expected slice and `count` reports the total before slicing.
    for (let i = 1; i <= 5; i++) {
      await dynamic.todo.create({
        data: {
          id: `todo-${i}`,
          title: `Todo ${i}`,
          tenantId: "t-1",
          createdAt: new Date(2026, 0, i),
        } as never,
      });
    }
    // One row in a different tenant — must not leak into the
    // tenant-scoped count or page.
    await dynamic.todo.create({
      data: {
        id: "todo-other",
        title: "Other tenant",
        tenantId: "t-2",
        createdAt: new Date(),
      } as never,
    });

    const page = await dynamic.todo.findMany({
      where: { tenantId: "t-1" } as never,
      orderBy: { createdAt: "asc" },
      skip: 1,
      take: 2,
    } as never);

    // page = rows 2 and 3 of 5 in ascending createdAt order.
    expect(page).toHaveLength(2);
    expect(page.map((r) => r.id)).toEqual(["todo-2", "todo-3"]);

    const total = await dynamic.todo.count({ where: { tenantId: "t-1" } as never });
    expect(total).toBe(5);
  });

  it("treats absent `skip` as 0 and absent `take` as no upper bound", async () => {
    const dynamic = fake as unknown as Record<
      string,
      ReturnType<typeof createFakePrisma>["example"]
    >;
    for (let i = 1; i <= 3; i++) {
      await dynamic.note.create({
        data: { id: `n-${i}`, ord: i, createdAt: new Date(2026, 0, i) } as never,
      });
    }
    // No skip/take — should return all matching rows, ordered.
    const all = await dynamic.note.findMany({ orderBy: { ord: "asc" } });
    expect(all.map((r) => r.id)).toEqual(["n-1", "n-2", "n-3"]);
  });

  it("count({}) returns total when no where is supplied", async () => {
    const dynamic = fake as unknown as Record<
      string,
      ReturnType<typeof createFakePrisma>["example"] & {
        count(input?: { where?: Record<string, unknown> }): Promise<number>;
      }
    >;
    await dynamic.invoice.create({ data: { id: "i-1" } as never });
    await dynamic.invoice.create({ data: { id: "i-2" } as never });
    expect(await dynamic.invoice.count()).toBe(2);
    expect(await dynamic.invoice.count({})).toBe(2);
  });

  /**
   * Story · `where: { col: null }` matches a row whose column was
   * never assigned (friction-log 2026-05-03 entry "fake-prisma's
   * `where: { col: null }` doesn't match an undefined column").
   *
   * Real Prisma + Postgres treat "column was never assigned on insert"
   * and `IS NULL` identically because the column defaults to NULL.
   * The fake's original `row[key] !== value` check returned `false`
   * for `undefined !== null`, excluding rows with omitted columns —
   * which silently broke every soft-delete `findMany({ where: {
   * deletedAt: null } })` call. Fix: normalise so `undefined` and
   * `null` compare equal for filter equality only.
   */
  describe("null/undefined equality (matches real Prisma)", () => {
    it("matches a row created without `deletedAt` when filtering by `deletedAt: null`", async () => {
      const dynamic = fake as unknown as Record<
        string,
        ReturnType<typeof createFakePrisma>["example"]
      >;
      // Create a row WITHOUT a `deletedAt` field — equivalent to a
      // soft-delete-aware schema where the column defaults to NULL.
      await dynamic.todo.create({
        data: { id: "todo-active", title: "Active todo", tenantId: "t-1" } as never,
      });
      const rows = await dynamic.todo.findMany({
        where: { tenantId: "t-1", deletedAt: null } as never,
      });
      expect(rows.map((r) => r.id)).toEqual(["todo-active"]);
    });

    it("excludes rows whose column is explicitly set to a non-null value", async () => {
      const dynamic = fake as unknown as Record<
        string,
        ReturnType<typeof createFakePrisma>["example"]
      >;
      // One soft-deleted row, one active row.
      await dynamic.todo.create({
        data: { id: "todo-active", title: "Active", tenantId: "t-1" } as never,
      });
      await dynamic.todo.create({
        data: {
          id: "todo-soft-deleted",
          title: "Removed",
          tenantId: "t-1",
          deletedAt: new Date("2026-01-01"),
        } as never,
      });
      const rows = await dynamic.todo.findMany({
        where: { tenantId: "t-1", deletedAt: null } as never,
      });
      expect(rows.map((r) => r.id)).toEqual(["todo-active"]);
    });

    it("`count({ where: { deletedAt: null } })` includes rows with the column omitted", async () => {
      const dynamic = fake as unknown as Record<
        string,
        ReturnType<typeof createFakePrisma>["example"] & {
          count(input?: { where?: Record<string, unknown> }): Promise<number>;
        }
      >;
      await dynamic.todo.create({
        data: { id: "a", title: "A", tenantId: "t-1" } as never,
      });
      await dynamic.todo.create({
        data: { id: "b", title: "B", tenantId: "t-1" } as never,
      });
      await dynamic.todo.create({
        data: {
          id: "c",
          title: "C",
          tenantId: "t-1",
          deletedAt: new Date(),
        } as never,
      });
      const total = await dynamic.todo.count({
        where: { tenantId: "t-1", deletedAt: null } as never,
      });
      expect(total).toBe(2);
    });

    it("symmetric: `findUnique` + `update` honour the same null/undefined equivalence", async () => {
      const dynamic = fake as unknown as Record<
        string,
        ReturnType<typeof createFakePrisma>["example"]
      >;
      const created = await dynamic.todo.create({
        data: { id: "t-1", title: "Foo" } as never,
      });
      // findUnique on a where with `deletedAt: null` finds it even though
      // the row never had `deletedAt` assigned — matches Prisma's
      // semantics where the column is NULL by default.
      const found = await dynamic.todo.findUnique({
        where: { id: created.id, deletedAt: null } as never,
      });
      expect(found).not.toBeNull();
      // Same for update — used by services that gate updates on
      // "still alive" rows.
      const updated = await dynamic.todo.update({
        where: { id: created.id, deletedAt: null } as never,
        data: { title: "Bar" } as never,
      });
      expect(updated.title).toBe("Bar");
    });
  });
});
