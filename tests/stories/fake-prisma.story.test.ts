import { beforeEach, describe, expect, it } from "vitest";

import { createFakePrisma, type FakePrismaService } from "../lib/fake-prisma.js";

/**
 * Story · `createFakePrisma` extensibility.
 *
 * The fake PrismaService is a template-owned helper (`tests/lib/`).
 * Originally it hardcoded the table mocks the template ships with
 * (`example`, `userProfile`), which meant every `src/modules/<x>/`
 * resource that wanted a story test had to force-edit the template
 * file — a hot-spot in every upstream sync.
 *
 * The Proxy variant lets specs reach for any table name on the fake
 * (`fake.todo`, `fake.invoice`, `fake.whatever`) and get back a
 * working `TableMock` without touching `tests/lib/fake-prisma.ts`.
 *
 * Backwards compatibility is non-negotiable: the existing two table
 * mocks (`example`, `userProfile`) must keep behaving exactly as
 * before, including the shared `__resetAll()` reset.
 */
describe("Story · createFakePrisma (extensible Proxy)", () => {
  let fake: FakePrismaService;

  beforeEach(() => {
    fake = createFakePrisma();
  });

  it("auto-creates a TableMock for an unknown table name on first access", async () => {
    // No registration step — the spec just uses the table.
    const dynamic = fake as unknown as Record<
      string,
      ReturnType<typeof createFakePrisma>["example"]
    >;

    const created = await dynamic.todo.create({
      data: { id: "todo-1", title: "Buy milk" } as never,
    });
    expect(created).toMatchObject({ id: "todo-1", title: "Buy milk" });
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);

    const found = await dynamic.todo.findUnique({ where: { id: "todo-1" } as never });
    expect(found).toMatchObject({ id: "todo-1", title: "Buy milk" });
  });

  it("returns the same TableMock instance for repeated accesses (stable identity)", () => {
    const dynamic = fake as unknown as Record<string, unknown>;
    const first = dynamic.todo;
    const second = dynamic.todo;
    expect(first).toBe(second);
  });

  it("preserves the existing `example` and `userProfile` table mocks (BC)", async () => {
    const example = await fake.example.create({
      data: { id: "ex-1", name: "Example" } as never,
    });
    expect(example).toMatchObject({ id: "ex-1", name: "Example" });

    const profile = await fake.userProfile.create({
      data: { id: "u-1", displayName: "Pat" } as never,
    });
    expect(profile).toMatchObject({ id: "u-1", displayName: "Pat" });

    expect(await fake.example.findMany()).toHaveLength(1);
    expect(await fake.userProfile.findMany()).toHaveLength(1);
  });

  it("__resetAll clears every dynamically-accessed table too", async () => {
    const dynamic = fake as unknown as Record<
      string,
      ReturnType<typeof createFakePrisma>["example"]
    >;
    await dynamic.invoice.create({ data: { id: "inv-1" } as never });
    await fake.example.create({ data: { id: "ex-1" } as never });

    fake.__resetAll();

    expect(await dynamic.invoice.findMany()).toEqual([]);
    expect(await fake.example.findMany()).toEqual([]);
  });

  it("runWithRlsTenant still passes the same fake as the tx", async () => {
    const dynamic = fake as unknown as Record<
      string,
      ReturnType<typeof createFakePrisma>["example"]
    >;
    const result = await fake.runWithRlsTenant(async (tx) => {
      // The tx exposes the same Proxy surface as the outer fake.
      const txDynamic = tx as unknown as Record<
        string,
        ReturnType<typeof createFakePrisma>["example"]
      >;
      await txDynamic.todo.create({ data: { id: "todo-tx-1", note: "from tx" } as never });
      return txDynamic.todo.findMany();
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "todo-tx-1", note: "from tx" });

    // Outer access reads the same backing store (tx returns `fake` itself).
    const outer = await dynamic.todo.findMany();
    expect(outer).toHaveLength(1);
  });
});
