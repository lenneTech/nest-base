import { Prisma } from "@prisma/client";

import type { BlindIndex } from "../encryption/blind-index.js";

/**
 * Prisma extension that auto-populates `User.emailHash` (the blind
 * index companion to `User.email`) on every `create` / `update` /
 * `upsert` issued through the extended client (CF.SEC.03 — iter-94).
 *
 * The extension is wired by `PrismaService.buildExtendedClient()`
 * when `BLIND_INDEX_KEY` is set. Projects that don't need
 * blind-index lookups skip the env-var entirely; the extension is
 * a no-op when the supplied `blindIndex` argument is `null`.
 *
 * Trigger semantics:
 *   - `create({ data: { email, ... } })` → emailHash = HMAC(email)
 *   - `update({ data: { email: "new" } })` → emailHash recomputed
 *   - `update({ data: { name: "..." } })` → no email change → no
 *     emailHash mutation (the row keeps its existing hash)
 *   - `upsert(...)` → both branches stamped
 *
 * The HMAC is deterministic + case-folded (the `BlindIndex` planner
 * normalises before hashing) so equality lookups via
 * `findUserByEmail` work regardless of the caller's email casing.
 */
/**
 * Build the per-callback config the extension uses for the `User`
 * model. Exported separately from `buildUserEmailBlindIndexExtension`
 * so tests can drive `create` / `update` / `upsert` callbacks
 * directly without a Prisma client. (iter-160)
 */
export function buildUserEmailBlindIndexCallbacks(blindIndex: BlindIndex) {
  return {
    async create({
      args,
      query,
    }: {
      args: { data?: Record<string, unknown> };
      query: (args: { data?: Record<string, unknown> }) => Promise<unknown>;
    }) {
      const data = args.data ?? {};
      const email = typeof data.email === "string" ? data.email : null;
      if (email !== null) {
        const hash = blindIndex.compute(email);
        if (hash !== null) {
          data.emailHash = hash;
        }
      }
      return query({ ...args, data });
    },
    async update({
      args,
      query,
    }: {
      args: { data?: Record<string, unknown> };
      query: (args: { data?: Record<string, unknown> }) => Promise<unknown>;
    }) {
      const data = args.data ?? {};
      const email = typeof data.email === "string" ? data.email : null;
      if (email !== null) {
        const hash = blindIndex.compute(email);
        if (hash !== null) {
          data.emailHash = hash;
        }
      }
      return query({ ...args, data });
    },
    async upsert({
      args,
      query,
    }: {
      args: {
        create?: Record<string, unknown>;
        update?: Record<string, unknown>;
      };
      query: (args: object) => Promise<unknown>;
    }) {
      if (args.create && typeof args.create.email === "string") {
        const hash = blindIndex.compute(args.create.email);
        if (hash !== null) args.create.emailHash = hash;
      }
      if (args.update && typeof args.update.email === "string") {
        const hash = blindIndex.compute(args.update.email);
        if (hash !== null) args.update.emailHash = hash;
      }
      return query(args);
    },
  };
}

export function buildUserEmailBlindIndexExtension(blindIndex: BlindIndex | null) {
  if (!blindIndex) {
    return Prisma.defineExtension({ name: "user-email-blind-index" });
  }

  const callbacks = buildUserEmailBlindIndexCallbacks(blindIndex);

  return Prisma.defineExtension({
    name: "user-email-blind-index",
    query: {
      user: {
        async create({ args, query }) {
          return callbacks.create({
            args: args as { data?: Record<string, unknown> },
            query: (next) => query(bridgeQueryArgs<Parameters<typeof query>[0]>(next)),
          });
        },
        async update({ args, query }) {
          return callbacks.update({
            args: args as { data?: Record<string, unknown> },
            query: (next) => query(bridgeQueryArgs<Parameters<typeof query>[0]>(next)),
          });
        },
        async upsert({ args, query }) {
          return callbacks.upsert({
            args: args as {
              create?: Record<string, unknown>;
              update?: Record<string, unknown>;
            },
            query: (next) => query(bridgeQueryArgs<Parameters<typeof query>[0]>(next)),
          });
        },
      },
    },
  });
}

/**
 * Type-erasing bridge for Prisma extension `query()` callbacks.
 * The Prisma extension API typed `query` as `(args: A) => Promise<R>`
 * where A is the operation-specific args generic; passing back a
 * structurally-modified args object trips the strict generic narrow.
 * The runtime contract accepts the modified args directly — the
 * helper centralises the cast in one place.
 */
function bridgeQueryArgs<T>(args: object): T {
  return args as T;
}
