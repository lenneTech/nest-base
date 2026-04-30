import { describe, expect, it } from "vitest";

import { buildBetterAuth } from "../../src/core/auth/better-auth.js";

/**
 * Story · Better-Auth factory accepts an optional Prisma instance.
 *
 * Without `prisma`, the factory falls back to Better-Auth's built-in
 * memory adapter (suitable for the JWT/SDK story tests that build the
 * instance just to inspect the handler). With `prisma`, the factory
 * wires Better-Auth's `prismaAdapter` so sign-ups, sign-ins, sessions,
 * and verification tokens persist into the Postgres tables declared
 * in `prisma/schema.prisma`.
 *
 * The factory keeps `prisma` optional for two reasons:
 *  1. unit / story tests that don't need a live DB
 *  2. early boot — `BetterAuthModule` returns `null` when the secret
 *     is missing; Prisma might not be wired in those cases either.
 */
describe("Story · Better-Auth factory · Prisma persistence", () => {
  it("returns an instance whose options.database is the in-memory adapter when no prisma is passed", () => {
    const auth = buildBetterAuth({
      secret: "a".repeat(32),
      baseUrl: "http://localhost:3000",
      sessionExpiresInSeconds: 60,
    });
    // No persistence configured → Better-Auth's built-in memory adapter.
    expect(auth.options.database).toBeUndefined();
  });

  it("wires `database: prismaAdapter(...)` when a `prisma` argument is supplied", () => {
    // Minimal Prisma stand-in: the adapter only calls `$transaction`
    // and the model accessors. We're exercising the wiring, not the
    // real DB roundtrip — that's covered by the e2e spec.
    const stubPrisma = {
      $transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(stubPrisma),
      user: {},
      session: {},
      account: {},
      verification: {},
    };
    const auth = buildBetterAuth({
      secret: "a".repeat(32),
      baseUrl: "http://localhost:3000",
      sessionExpiresInSeconds: 60,
      prisma: stubPrisma as unknown as never,
    });
    // Better-Auth normalises `database` into a function once a real
    // adapter is supplied. Whatever the precise shape is, presence is
    // the load-bearing assertion: without `prisma` it's `undefined`.
    expect(auth.options.database).toBeDefined();
  });
});
