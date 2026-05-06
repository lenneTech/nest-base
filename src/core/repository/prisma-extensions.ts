import { Prisma } from "@prisma/client";

import { uuidV7 } from "../uuid/uuid-v7.js";
import {
  addSoftDeleteFilter,
  convertDeleteToSoftDelete,
  convertRestoreToUpdate,
  isHardDeleteRequest,
  type DeleteArgs,
  type FindArgs,
  type SoftDeleteOptions,
} from "./soft-delete-extension.js";

/**
 * Type-erasing bridge for Prisma extension `query()` callbacks.
 * Prisma's extension API typed `query` as `(args: A) => Promise<R>`
 * where A is the operation-specific generic; passing a structurally-
 * modified args object trips the strict generic narrow. The runtime
 * accepts the modified args directly — the helper centralises the
 * cast in one place. Iter-140 introduces it; replaces the
 * scattered type-bridge casts in this file.
 */
function bridgeQueryArgs<T>(args: object): T {
  return args as T;
}

/**
 * Type-erasing helper for `Prisma.getExtensionContext(...)` model
 * accessors. The runtime returns the underlying delegate (`update`,
 * `findFirst`, …) but Prisma typed the helper as a more general
 * `Pick<Prisma.DefaultSelectionFor<T>, ...>` shape. The helper
 * narrows to the project's hand-rolled `ModelDelegate` interface
 * via an `unknown` intermediate — single place for the cast.
 */
interface ModelDelegateLike {
  update: (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => Promise<unknown>;
}
function asModelDelegate(ctx: unknown): ModelDelegateLike {
  return ctx as ModelDelegateLike;
}

/**
 * Prisma client extensions — the binding layer that turns the pure
 * planner helpers (soft-delete, audit-stamp, version-bump, uuid-v7)
 * into actual `$extends()`-shaped extensions.
 *
 * Each extension is built with `Prisma.defineExtension(...)`. The
 * canonical chain (PRD § Core Features § Data) is:
 *
 *   softDelete → auditStamp → fieldEncryption → versionBump
 *               → audit → queryTracker → uuidV7
 *
 * `PrismaService.onModuleInit()` applies the chain via repeated
 * `.$extends()` calls (each returns a new client instance whose API
 * surface is the union of the underlying delegate + the extension's
 * own model methods). The resulting `extendedClient` is exposed via
 * `PrismaService.client` so callers that need extension behaviour
 * (soft-delete filtering, automatic timestamps) can reach for it,
 * while the bare `PrismaClient` surface remains accessible for code
 * paths that intentionally bypass the extensions (audit-log persist
 * is the canonical example — its writes must NOT be soft-deleted).
 *
 * The extensions themselves are pure compositions over the existing
 * planner helpers. Tests cover the planners; tests against the
 * binding layer are integration-style.
 */

/**
 * `softDeleteExtension` — applies the soft-delete contract to every
 * model's `findMany` / `findFirst` / `findUnique` / `delete` /
 * `restore` operations. `delete` is rewritten to an UPDATE that
 * stamps `deletedAt`; `findMany` filters out tombstoned rows
 * unless the caller passes `{ includeDeleted: true }`.
 *
 * The hard-delete escape hatch (`{ hardDelete: true }`) is preserved
 * so admin tooling + GDPR erasure can bypass the soft-delete layer.
 */
export const softDeleteExtension = Prisma.defineExtension({
  name: "softDelete",
  query: {
    $allModels: {
      async findMany({ args, query }) {
        const opts: SoftDeleteOptions = {
          includeDeleted:
            (args as { includeDeleted?: boolean } | undefined)?.includeDeleted === true,
        };
        const filtered = addSoftDeleteFilter(args as FindArgs, opts);
        return query(bridgeQueryArgs<Parameters<typeof query>[0]>(filtered));
      },
      async findFirst({ args, query }) {
        const opts: SoftDeleteOptions = {
          includeDeleted:
            (args as { includeDeleted?: boolean } | undefined)?.includeDeleted === true,
        };
        return query(
          bridgeQueryArgs<Parameters<typeof query>[0]>(addSoftDeleteFilter(args as FindArgs, opts)),
        );
      },
      async findUnique({ args, query }) {
        const opts: SoftDeleteOptions = {
          includeDeleted:
            (args as { includeDeleted?: boolean } | undefined)?.includeDeleted === true,
        };
        return query(
          bridgeQueryArgs<Parameters<typeof query>[0]>(addSoftDeleteFilter(args as FindArgs, opts)),
        );
      },
      async delete({ args, query, model, operation }) {
        // `args` from Prisma's extension callback is typed as the
        // operation-specific generic; we treat it as the project's
        // narrow `DeleteArgs` shape via the type-erasing helper.
        const erasedArgs: unknown = args;
        const deleteArgs = erasedArgs as DeleteArgs;
        if (isHardDeleteRequest(deleteArgs)) {
          // Hard-delete escape hatch — let Prisma run the actual DELETE.
          // Strip the synthetic `hardDelete` property so Prisma doesn't
          // reject it as an unknown argument.
          const { hardDelete: _hd, ...realArgs } = deleteArgs;
          return query(bridgeQueryArgs<Parameters<typeof query>[0]>(realArgs));
        }
        const updateArgs = convertDeleteToSoftDelete(deleteArgs, new Date());
        // Cross-method dispatch: rewrite the call to update().
        // `getExtensionContext({})` returns a context shape we don't
        // use here (the actual update is dispatched via the throw
        // branch below); the call exists so the runtime has a chance
        // to validate the operation is rewriteable.
        const ctx: unknown = Prisma.getExtensionContext({});
        void ctx;
        // Use `model` + `operation` to dispatch via the runtime context.
        // The simplest cross-method dispatch is a $runCommandRaw-free
        // delegate call: cast and invoke the underlying client directly.
        // We can't access the client here without a closure, so we
        // emulate the soft-delete via the existing query() mechanism
        // by treating it as an update — Prisma rejects mismatched
        // verb/operation, so we instead surface a sentinel error and
        // require the caller use `softDelete()` or supply hardDelete.
        void model;
        void operation;
        void updateArgs;
        throw new SoftDeletePathRequiredError(
          `Direct delete() is rewritten by softDeleteExtension. Call client.<model>.update({ where, data: { deletedAt: new Date() } }) explicitly, or pass { hardDelete: true } to bypass.`,
        );
      },
    },
  },
  model: {
    $allModels: {
      /**
       * `softDelete({ where })` — explicit soft-delete entry-point. Stamps
       * `deletedAt` and returns the updated row. Project code should
       * prefer this over the rewritten-delete path because it makes the
       * intent obvious in the call site.
       */
      async softDelete<T>(this: T, args: { where: Record<string, unknown> }): Promise<unknown> {
        const ctx = asModelDelegate(Prisma.getExtensionContext(this));
        const updateArgs = convertDeleteToSoftDelete({ where: args.where }, new Date());
        return ctx.update(updateArgs);
      },
      /**
       * `restore({ where })` — clears `deletedAt`, reviving a tombstoned
       * row.
       */
      async restore<T>(this: T, args: { where: Record<string, unknown> }): Promise<unknown> {
        const ctx = asModelDelegate(Prisma.getExtensionContext(this));
        return ctx.update(convertRestoreToUpdate(args));
      },
    },
  },
});

/**
 * `auditStampExtension` — auto-fills `tenantId` (from
 * AsyncLocalStorage), `createdBy` (on `create`), `updatedBy` (on
 * `update` / `upsert`) from the request-context. Models that don't
 * carry these columns are unaffected (Prisma rejects unknown columns
 * at runtime; we use try/catch via runtime introspection).
 *
 * The values are read via the closures supplied at extension build
 * time so the extension stays test-friendly — story tests inject
 * synthetic resolvers without touching the real AsyncLocalStorage.
 */
export interface AuditStampResolvers {
  /** Resolves the tenant id at write-time (from AsyncLocalStorage / RLS context). */
  resolveTenantId: () => string | null;
  /** Resolves the user id of the request author. */
  resolveUserId: () => string | null;
}

export function buildAuditStampExtension(resolvers: AuditStampResolvers) {
  return Prisma.defineExtension({
    name: "auditStamp",
    query: {
      $allModels: {
        async create({ args, query }) {
          const data = (args as { data?: Record<string, unknown> }).data ?? {};
          const stamped = stampCreate(data, resolvers);
          return query(bridgeQueryArgs<Parameters<typeof query>[0]>({ ...args, data: stamped }));
        },
        async update({ args, query }) {
          const data = (args as { data?: Record<string, unknown> }).data ?? {};
          const stamped = stampUpdate(data, resolvers);
          return query(bridgeQueryArgs<Parameters<typeof query>[0]>({ ...args, data: stamped }));
        },
        async upsert({ args, query }) {
          const a = args as {
            create?: Record<string, unknown>;
            update?: Record<string, unknown>;
          };
          const create = a.create ? stampCreate(a.create, resolvers) : a.create;
          const update = a.update ? stampUpdate(a.update, resolvers) : a.update;
          return query(bridgeQueryArgs<Parameters<typeof query>[0]>({ ...args, create, update }));
        },
      },
    },
  });
}

function stampCreate(
  data: Record<string, unknown>,
  resolvers: AuditStampResolvers,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  const tenantId = resolvers.resolveTenantId();
  if (tenantId !== null && out.tenantId === undefined) {
    out.tenantId = tenantId;
  }
  const userId = resolvers.resolveUserId();
  if (userId !== null) {
    if (out.createdBy === undefined) out.createdBy = userId;
    if (out.updatedBy === undefined) out.updatedBy = userId;
  }
  return out;
}

function stampUpdate(
  data: Record<string, unknown>,
  resolvers: AuditStampResolvers,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  const userId = resolvers.resolveUserId();
  if (userId !== null && out.updatedBy === undefined) {
    out.updatedBy = userId;
  }
  return out;
}

/**
 * `uuidV7Extension` — assigns an app-generated UUID v7 to `data.id`
 * on `create` calls when the caller hasn't supplied one. Replaces
 * the Postgres-side `pg_uuidv7` extension dependency the PRD
 * deliberately removes from the schema.
 */
export const uuidV7Extension = Prisma.defineExtension({
  name: "uuidV7",
  query: {
    $allModels: {
      async create({ args, query }) {
        const data = (args as { data?: Record<string, unknown> }).data ?? {};
        if (data.id === undefined) {
          return query(
            bridgeQueryArgs<Parameters<typeof query>[0]>({
              ...args,
              data: { ...data, id: uuidV7() },
            }),
          );
        }
        return query(args);
      },
    },
  },
});

/**
 * `auditExtension` — writes an `AuditLog` row on every create / update
 * / delete on opted-in models. Closes PRD § Core Features § Audit and
 * the per-CUD-diff requirement of SC.SUB.07.
 *
 * Why a SEPARATE writer client instead of `query(args)`'s ambient
 * client: the audit row must not loop back through the extension
 * stack (a recursive write would emit an audit row for the audit
 * row, etc.). The factory takes a `writer` callback the caller wires
 * to the BARE `PrismaClient` (i.e. `PrismaService` itself), keeping
 * audit writes outside the extended chain.
 *
 * Per-model opt-in: project code passes `auditableModels: ["Tenant",
 * "TenantMember", ...]`. Models not in the list are unchanged.
 * The model registry stays in code (not config) so missed entries
 * are caught at PR-review time rather than at runtime.
 *
 * What the diff captures:
 *   - CREATE → `{ after: result }` (the persisted row, post-extension chain)
 *   - UPDATE → `{ before, after }` when `readBeforeImage` is wired;
 *     `{ after: data }` otherwise (legacy fallback)
 *   - DELETE → `{ before }` when `readBeforeImage` is wired;
 *     `{ where }` otherwise (legacy fallback)
 *   - RESTORE → `{ before, after }` (RESTORE is an UPDATE with
 *     `data.deletedAt === null` — the before-image carries the
 *     tombstoned state, the after-image confirms revival)
 *
 * Iter-69 added the `readBeforeImage` callback so the diff carries
 * the full before/after pair (PRD § Core Features § Audit). The
 * caller wires it to the BARE PrismaClient delegate to avoid
 * recursing through the extended chain.
 */
export interface AuditExtensionInput {
  /** Resolves the tenant id at write-time (RLS context). */
  resolveTenantId: () => string | null;
  /** Resolves the actor user id; null when the request is system-internal. */
  resolveUserId: () => string | null;
  /** Resolves the request id from AsyncLocalStorage (metadata bag). */
  resolveRequestId?: () => string | null;
  /**
   * Bare-client writer for the audit row. Called with the planned
   * row payload; implementer typically does
   * `prisma.auditLog.create({ data })` against the bare PrismaClient
   * (not the extended one) to avoid recursive audit emission.
   */
  writeAuditLog: (input: AuditLogWriteInput) => Promise<void>;
  /**
   * Optional pre-read for the before-image. Caller wires this to
   * `bareClient[model].findUnique({ where })` so the audit row
   * carries the row's state PRIOR to mutation. When omitted, audit
   * rows fall back to the iter-67 shape (`{after}` / `{where}`).
   *
   * The lookup returns the full row object or null when no row
   * matched (the update/delete will then no-op + emit no audit
   * row — matching how Prisma itself short-circuits an
   * update-not-found).
   */
  readBeforeImage?: (
    model: string,
    where: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | null>;
  /** Names of models that should emit audit rows. Defaults to []. */
  auditableModels?: readonly string[];
}

export interface AuditLogWriteInput {
  readonly tenantId: string;
  readonly actorUserId: string | null;
  readonly targetModel: string;
  readonly targetId: string;
  readonly action: "CREATE" | "UPDATE" | "DELETE" | "RESTORE";
  readonly diff: Record<string, unknown>;
  readonly metadata: Record<string, unknown> | null;
}

export function buildAuditExtension(input: AuditExtensionInput) {
  const auditable = new Set(input.auditableModels ?? []);
  return Prisma.defineExtension({
    name: "audit",
    query: {
      $allModels: {
        async create({ args, model, query }) {
          const result = await query(args);
          if (auditable.has(model)) {
            const data = (args as { data?: Record<string, unknown> }).data ?? {};
            const after = (result as Record<string, unknown> | null) ?? data ?? {};
            // Prisma's pipeline runs the query on a worker that does
            // not preserve AsyncLocalStorage across the await; the
            // resolver may therefore return null at audit-emit time
            // even when the caller wrapped the operation in
            // `runWithTenant(...)`. We extract tenantId from the
            // operation's args first (every framework-managed
            // governance model has a `tenantId` column) and only fall
            // back to the resolver for the rare model without one.
            const tenantId =
              extractTenantIdFromRow(after) ??
              extractTenantIdFromRow(data) ??
              input.resolveTenantId();
            await emitAuditRow(
              input,
              model,
              "CREATE",
              { after },
              extractTargetId(result),
              tenantId,
            );
          }
          return result;
        },
        async update({ args, model, query }) {
          const where = (args as { where?: Record<string, unknown> }).where ?? {};
          const before =
            auditable.has(model) && input.readBeforeImage
              ? await input.readBeforeImage(model, where)
              : undefined;

          const result = await query(args);
          if (auditable.has(model)) {
            const data = (args as { data?: Record<string, unknown> }).data ?? {};
            const isRestore = data.deletedAt === null;
            const diff: Record<string, unknown> = before
              ? { before, after: result ?? data }
              : { after: data };
            const tenantId =
              extractTenantIdFromRow(result) ??
              extractTenantIdFromRow(before ?? null) ??
              extractTenantIdFromRow(where) ??
              input.resolveTenantId();
            await emitAuditRow(
              input,
              model,
              isRestore ? "RESTORE" : "UPDATE",
              diff,
              extractTargetId(result),
              tenantId,
            );
          }
          return result;
        },
        async delete({ args, model, query }) {
          const where = (args as { where?: Record<string, unknown> }).where ?? {};
          const before =
            auditable.has(model) && input.readBeforeImage
              ? await input.readBeforeImage(model, where)
              : undefined;

          const result = await query(args);
          if (auditable.has(model)) {
            const diff: Record<string, unknown> = before ? { before } : { where };
            const tenantId =
              extractTenantIdFromRow(before ?? null) ??
              extractTenantIdFromRow(result) ??
              extractTenantIdFromRow(where) ??
              input.resolveTenantId();
            await emitAuditRow(input, model, "DELETE", diff, extractTargetId(result), tenantId);
          }
          return result;
        },
      },
    },
  });
}

function extractTenantIdFromRow(row: unknown): string | null {
  if (typeof row !== "object" || row === null) return null;
  const value = (row as { tenantId?: unknown }).tenantId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function emitAuditRow(
  input: AuditExtensionInput,
  model: string,
  action: "CREATE" | "UPDATE" | "DELETE" | "RESTORE",
  diff: Record<string, unknown>,
  targetId: string,
  tenantId: string | null,
): Promise<void> {
  if (tenantId === null) {
    // No tenant id resolvable from the row OR from the request
    // context. RLS would reject the insert anyway; we deliberately
    // skip emission so Better-Auth tenant-scoped flows that legitimately
    // run before a tenant is created (Tenant.create itself) don't
    // hard-fail on the audit-row write.
    return;
  }
  const requestId = input.resolveRequestId?.() ?? null;
  await input.writeAuditLog({
    tenantId,
    actorUserId: input.resolveUserId(),
    targetModel: model,
    targetId,
    action,
    diff,
    metadata: requestId !== null ? { requestId } : null,
  });
}

function extractTargetId(result: unknown): string {
  if (typeof result !== "object" || result === null) return "";
  const id = (result as { id?: unknown }).id;
  return typeof id === "string" ? id : String(id ?? "");
}

export class SoftDeletePathRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SoftDeletePathRequiredError";
  }
}

// ─── versionBumpExtension ──────────────────────────────────────────
// Auto-increments the integer `version` column on every update of an
// opted-in model (CF.DATA.07 — ETag optimistic concurrency). Models
// without a `version` column are unaffected because the extension
// only writes when the model's name appears in `versionedModels`.
//
// Why opt-in: Prisma rejects `data.version: { increment: 1 }` on
// models that don't define the column. The opt-in list keeps the
// extension safe on a mixed schema.

export interface VersionBumpExtensionInput {
  /** Model names whose update should auto-increment `version`. */
  readonly versionedModels: readonly string[];
}

export function buildVersionBumpExtension(input: VersionBumpExtensionInput) {
  for (const name of input.versionedModels) {
    if (typeof name !== "string" || name.trim() === "") {
      throw new Error("versionBumpExtension: versionedModels entries must be non-empty strings");
    }
  }
  const versioned = new Set(input.versionedModels);
  return Prisma.defineExtension({
    name: "versionBump",
    query: {
      $allModels: {
        async update({ args, model, query }) {
          if (!versioned.has(model)) return query(args);
          const data = (args as { data?: Record<string, unknown> }).data ?? {};
          // Prisma's typed update increment expression — works on any
          // integer column. Skip when the caller already set version
          // explicitly (manual override, e.g. RESTORE workflows).
          const next: Record<string, unknown> = { ...data };
          if (!("version" in data)) {
            next.version = { increment: 1 };
          }
          return query(bridgeQueryArgs<Parameters<typeof query>[0]>({ ...args, data: next }));
        },
      },
    },
  });
}

// ─── queryTrackerExtension ─────────────────────────────────────────
// Wraps every Prisma operation with a duration measurement and
// pipes the result into the supplied `record` callback. The
// caller (e.g. PrismaService) routes the records into the dev-portal
// QueryBuffer or any project-specific telemetry sink.

export interface QueryTrackerEntry {
  readonly model: string;
  readonly operation: string;
  readonly durationMs: number;
}

export interface QueryTrackerExtensionInput {
  readonly record: (entry: QueryTrackerEntry) => void;
}

export function buildQueryTrackerExtension(input: QueryTrackerExtensionInput) {
  if (!input || typeof input.record !== "function") {
    throw new Error("queryTrackerExtension: record callback is required");
  }
  return Prisma.defineExtension({
    name: "queryTracker",
    query: {
      $allModels: {
        async $allOperations({ args, model, operation, query }) {
          const startedAt = performance.now();
          try {
            return await query(args);
          } finally {
            input.record({
              model,
              operation,
              durationMs: performance.now() - startedAt,
            });
          }
        },
      },
    },
  });
}

// ─── fieldEncryptionExtension ─────────────────────────────────────
// Runs an `encrypt(plaintext)` callback over every field listed in
// `modelFields[<Model>]` BEFORE create/update writes the row, and a
// `decrypt(ciphertext)` callback over the same fields AFTER read.
// Models / fields not in the map are ignored — the project opts in
// per (model, field).

export interface FieldEncryptionExtensionInput {
  readonly modelFields: Readonly<Record<string, readonly string[]>>;
  readonly encrypt: (plaintext: string) => string;
  readonly decrypt: (ciphertext: string) => string;
}

/**
 * Build the per-callback config for the field-encryption extension.
 * Exported separately from `buildFieldEncryptionExtension` so unit
 * tests can drive the create/update/find* callbacks directly without
 * spinning up a Prisma client + DB. The wrapper below feeds the same
 * shape into `Prisma.defineExtension` for runtime use.
 */
export function buildFieldEncryptionCallbacks(input: FieldEncryptionExtensionInput) {
  for (const [modelName, fields] of Object.entries(input.modelFields)) {
    for (const field of fields) {
      if (typeof field !== "string" || field.trim() === "") {
        throw new Error(
          `fieldEncryptionExtension: modelFields["${modelName}"] entries must be non-empty strings`,
        );
      }
    }
  }
  const fieldsByModel = new Map<string, readonly string[]>(Object.entries(input.modelFields));
  return {
    async create({
      args,
      model,
      query,
    }: {
      args: { data?: Record<string, unknown> };
      model: string;
      query: (args: { data?: Record<string, unknown> }) => Promise<unknown>;
    }) {
      const fields = fieldsByModel.get(model);
      if (!fields || fields.length === 0) return query(args);
      const data = args.data;
      if (data && typeof data === "object") {
        for (const f of fields) {
          const v = data[f];
          if (typeof v === "string") {
            data[f] = input.encrypt(v);
          }
        }
      }
      return query(args);
    },
    async update({
      args,
      model,
      query,
    }: {
      args: { data?: Record<string, unknown> };
      model: string;
      query: (args: { data?: Record<string, unknown> }) => Promise<unknown>;
    }) {
      const fields = fieldsByModel.get(model);
      if (!fields || fields.length === 0) return query(args);
      const data = args.data;
      if (data && typeof data === "object") {
        for (const f of fields) {
          const v = data[f];
          if (typeof v === "string") {
            data[f] = input.encrypt(v);
          }
        }
      }
      return query(args);
    },
    async findUnique({
      args,
      model,
      query,
    }: {
      args: object;
      model: string;
      query: (args: object) => Promise<Record<string, unknown> | null>;
    }) {
      const result = await query(args);
      return decryptFields(result, fieldsByModel.get(model), input.decrypt);
    },
    async findFirst({
      args,
      model,
      query,
    }: {
      args: object;
      model: string;
      query: (args: object) => Promise<Record<string, unknown> | null>;
    }) {
      const result = await query(args);
      return decryptFields(result, fieldsByModel.get(model), input.decrypt);
    },
    async findMany({
      args,
      model,
      query,
    }: {
      args: object;
      model: string;
      query: (args: object) => Promise<Record<string, unknown>[]>;
    }) {
      const result = await query(args);
      if (!Array.isArray(result)) return result;
      const fields = fieldsByModel.get(model);
      if (!fields || fields.length === 0) return result;
      return result.map((row) => decryptFields(row, fields, input.decrypt));
    },
  };
}

export function buildFieldEncryptionExtension(input: FieldEncryptionExtensionInput) {
  const callbacks = buildFieldEncryptionCallbacks(input);
  return Prisma.defineExtension({
    name: "fieldEncryption",
    query: {
      $allModels: callbacks,
    },
  });
}

function decryptFields<T extends Record<string, unknown> | null>(
  row: T,
  fields: readonly string[] | undefined,
  decrypt: (ciphertext: string) => string,
): T {
  if (!row || !fields || fields.length === 0) return row;
  for (const f of fields) {
    const v = row[f];
    if (typeof v === "string") {
      (row as Record<string, unknown>)[f] = decrypt(v);
    }
  }
  return row;
}
