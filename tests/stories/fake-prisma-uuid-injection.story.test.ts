import { beforeEach, describe, expect, it } from "vitest";

import { isUuidV7 } from "../../src/core/uuid/uuid-v7.js";
import { createFakePrisma, type FakePrismaService } from "../lib/fake-prisma.js";

/**
 * Story · `FakePrisma` UUID auto-injection (friction-log #10).
 *
 * `prisma/CLAUDE.md` recommends `@default(dbgenerated("uuid_generate_v7()"))`
 * for new feature-gated schemas. The default is server-side only —
 * Prisma client doesn't compute it client-side, so the fake's
 * `create({ data })` would store `id: undefined` and break every
 * subsequent `findUnique({ where: { id } })`.
 *
 * The fake fills the gap: when `data.id` is missing or `undefined`,
 * `create()` injects a fresh `uuidV7()` so the round-trip mirrors
 * what real Prisma + Postgres yield. Callers that DO supply an `id`
 * keep their explicit value (no surprise overwrite).
 */
describe("Story · FakePrisma auto-injects uuidV7 on create()", () => {
  let fake: FakePrismaService;

  beforeEach(() => {
    fake = createFakePrisma();
  });

  it("auto-fills a uuid v7 when `data.id` is absent", async () => {
    const dynamic = fake as unknown as Record<
      string,
      ReturnType<typeof createFakePrisma>["example"]
    >;
    const created = await dynamic.todo.create({ data: { title: "x" } as never });

    expect(typeof created.id).toBe("string");
    expect(isUuidV7(created.id)).toBe(true);
    expect((created as { title: string }).title).toBe("x");

    // The newly-injected id must be the lookup key as well.
    const found = await dynamic.todo.findUnique({ where: { id: created.id } as never });
    expect(found).not.toBeNull();
  });

  it("auto-fills when `data.id` is explicitly `undefined`", async () => {
    const dynamic = fake as unknown as Record<
      string,
      ReturnType<typeof createFakePrisma>["example"]
    >;
    const created = await dynamic.todo.create({
      data: { id: undefined, title: "y" } as never,
    });
    expect(typeof created.id).toBe("string");
    expect(isUuidV7(created.id)).toBe(true);
  });

  it("preserves an explicit `data.id` when one is supplied", async () => {
    const dynamic = fake as unknown as Record<
      string,
      ReturnType<typeof createFakePrisma>["example"]
    >;
    const created = await dynamic.todo.create({
      data: { id: "explicit-id", title: "z" } as never,
    });
    expect(created.id).toBe("explicit-id");
  });
});
