import {
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

import { buildUserEmailBlindIndexExtension } from "../auth/user-blind-index.extension.js";
import { EXTRA_AUDITABLE_MODELS } from "./prisma-tokens.js";
import { getQueryBuffer } from "../dx/query-buffer.js";
import { BlindIndex, planBlindIndexFromEnv } from "../encryption/blind-index.js";
import { EnvKekProvider, type KekProvider } from "../encryption/kek-provider.js";
import { parseFieldEncryptionMap } from "../encryption/field-encryption-config.js";
import { parseLegacyKeks } from "../encryption/legacy-kek-config.js";
import { MultiKekFieldEncryption } from "../encryption/multi-kek.service.js";
import { getCurrentTenantId } from "../multi-tenancy/tenant-context.js";
import { getRequestContext } from "../request-context/request-context.js";
import { loadFeatures } from "../features/features.js";
import {
  type AuditLogWriteInput,
  buildAuditExtension,
  buildAuditStampExtension,
  buildFieldEncryptionExtension,
  buildQueryTrackerExtension,
  buildVersionBumpExtension,
  softDeleteExtension,
  uuidV7Extension,
} from "../repository/prisma-extensions.js";

/**
 * Prisma 7 client wrapped as a NestJS provider.
 *
 * Prisma 7 moved the connection URL out of `schema.prisma` and now requires
 * a driver adapter. We use `@prisma/adapter-pg` — the URL comes from
 * `DATABASE_URL`, which testcontainers sets in tests and ENV-validation
 * sets in prod.
 *
 * Connection lifecycle:
 *   - `onModuleInit` opens the pool on app boot (so DB errors fail-fast).
 *   - `onModuleDestroy` flushes + disconnects on shutdown.
 *
 * Multi-tenancy / RLS:
 *   `runWithRlsTenant()` wraps a callback in a Postgres transaction
 *   and runs `SET LOCAL "app.tenant_id" = $1` before the callback so
 *   any RLS policy referencing `current_setting('app.tenant_id')`
 *   sees the right value. The interceptor reads the request header
 *   into `AsyncLocalStorage`; this method bridges to the DB layer.
 *
 * Migrations are NOT run from the application — they are managed via
 * `bun run prisma:migrate` in CI / dev.
 */
/**
 * Type alias for the Prisma client after the full extension chain
 * has been applied (`uuidV7 → auditStamp → softDelete → fieldEncryption →
 * versionBump → audit → queryTracker → userEmailBlindIndex`). Each
 * extension adds members to the client's API surface — the alias
 * collapses to `unknown` if any link breaks, which fails
 * type-checking visibly. Iter-117 extended the chain with
 * `fieldEncryption` (CF.SEC.01) so the runtime client now matches the
 * 7-extension stack the PRD pins.
 */
export type ExtendedPrismaClient = ReturnType<PrismaService["buildExtendedClient"]>;

/**
 * Static map from framework-managed Prisma model names → snake_case
 * Postgres table names. Used by the audit extension's `readBeforeImage`
 * to side-step the Prisma `delegate[model]` accessor (which is
 * unreliable inside class-method `this` contexts when Nest's IoC
 * wraps the PrismaService instance). Project code that opts new
 * models into auditable can extend this map at module-init time.
 */
/**
 * Framework-managed models opted into audit by default.
 *
 * Separated from the runtime `buildExtendedClient` call so the list
 * can be exported (for tests / docs) and so `EXTRA_AUDITABLE_MODELS`
 * can be merged without mutating a constant.
 */
export const CORE_AUDITABLE_MODELS: readonly string[] = [
  // Organization and Member replace the legacy Tenant/TenantMember (issue #118).
  "Organization",
  "Member",
  "Role",
  "RolePolicy",
  "Policy",
  "Permission",
  "ApiKey",
];

export const MODEL_TABLE_MAP: Record<string, string> = {
  // Organization and Member are the canonical tenant tables after issue #118.
  Organization: "organization",
  Member: "member",
  Role: "roles",
  RolePolicy: "role_policies",
  Policy: "policies",
  Permission: "permissions",
  ApiKey: "api_keys",
  User: "users",
  UserProfile: "user_profiles",
  File: "files",
  Folder: "folders",
  WebhookEndpoint: "webhook_endpoints",
};

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /**
   * Extension-extended client surface (PRD § Core Features § Data).
   * Built lazily on first access so tests that don't need the
   * extensions don't pay the construction cost. Lazy-initialised in
   * `buildExtendedClient()`; reset to undefined in `onModuleDestroy`.
   */
  private extendedClient:
    | ReturnType<typeof PrismaService.prototype.buildExtendedClient>
    | undefined;

  constructor(
    // Project modules can extend the audit log's opt-in list by
    // registering `{ provide: EXTRA_AUDITABLE_MODELS, useValue: ["Todo"] }`
    // in any module. The token is optional so projects that don't need
    // project-level audit tracking don't have to configure anything.
    @Optional()
    @Inject(EXTRA_AUDITABLE_MODELS)
    private readonly extraAuditableModels: string[] = [],
  ) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is required to construct PrismaService");
    }
    super({
      adapter: new PrismaPg({ connectionString: url }),
      // Emit `query` events so we can record durations into the
      // dev-hub's QueryBuffer. Tests opt out via `PRISMA_DISABLE_QUERY_BUFFER=1`
      // (the in-memory test setup doesn't need the noise).
      ...(process.env.PRISMA_DISABLE_QUERY_BUFFER === "1"
        ? {}
        : { log: [{ emit: "event", level: "query" }] }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    if (process.env.PRISMA_DISABLE_QUERY_BUFFER !== "1") {
      // `$on('query', …)` payload: { query, params, duration, target }.
      // We capture (sql, durationMs, requestId) — params are dropped to
      // avoid logging credentials / PII into the in-memory ring.
      const buffer = getQueryBuffer();
      // The Prisma type for $on('query') varies between minor versions.
      // Cast to a permissive event shape so we read the fields we need.
      type QueryEvent = { query: string; duration: number; timestamp?: Date };
      type PrismaWithQueryEvent = PrismaService & {
        $on(event: "query", handler: (event: QueryEvent) => void): void;
      };
      (this as PrismaWithQueryEvent).$on("query", (event: QueryEvent) => {
        const requestId = getRequestContext()?.requestId;
        buffer.record({
          sql: event.query,
          durationMs: event.duration,
          startedAtMs: event.timestamp ? event.timestamp.getTime() : Date.now(),
          ...(requestId ? { requestId } : {}),
        });
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.extendedClient = undefined;
    await this.$disconnect();
  }

  /**
   * Returns the extended client (uuidV7 → auditStamp → softDelete).
   * Built once per `PrismaService` instance and cached. Callers that
   * need the extension behaviour (auto-id, auto-tenantId/createdBy,
   * soft-delete filtering) reach for `prismaService.client` instead
   * of using the bare `prismaService` directly.
   *
   * The bare `PrismaService` keeps inheriting from `PrismaClient` so
   * existing call sites (audit-log persistence, RLS transactions)
   * continue to work — the extended client is opt-in.
   */
  get client(): ExtendedPrismaClient {
    if (!this.extendedClient) {
      this.extendedClient = this.buildExtendedClient();
    }
    return this.extendedClient;
  }

  /**
   * Internal — composes the extension chain. Exposed only so the
   * `ExtendedPrismaClient` type alias above can derive its shape via
   * `ReturnType`.
   */
  buildExtendedClient() {
    const auditStampExtension = buildAuditStampExtension({
      resolveTenantId: () => getCurrentTenantId() ?? null,
      // `RequestContext` doesn't currently carry a user id (the
      // Better-Auth session middleware attaches `req.user` directly
      // to the Express request rather than the AsyncLocalStorage
      // context). Until the request-context surface is extended,
      // `auditStamp` only fills `tenantId` automatically; project
      // code passes `createdBy` / `updatedBy` explicitly when it
      // wants them stamped.
      resolveUserId: () => null,
    });

    // Audit extension — only kicks in when `features.audit.enabled`
    // is on. The writer uses the captured `bareClient` callback (the
    // bare PrismaClient) so audit rows bypass the soft-delete +
    // auditStamp + uuidV7 extensions (audit-log writes must NOT
    // recurse through the chain).
    const features = loadFeatures(process.env as Record<string, string | undefined>);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const bareSelf = this;
    const auditExtension = buildAuditExtension({
      resolveTenantId: () => getCurrentTenantId() ?? null,
      resolveUserId: () => null,
      resolveRequestId: () => getRequestContext()?.requestId ?? null,
      writeAuditLog: async (row: AuditLogWriteInput) => {
        if (!features.audit.enabled) return;
        // Why $executeRaw instead of `bareClient().auditLog.create(...)`?
        // The `bareClient` closure captures `this` from the
        // `buildExtendedClient` method context. Prisma 7 + Nest's IoC
        // wrapping mean that `this.auditLog` (the lazy-materialised
        // model delegate) is sometimes undefined inside this audit
        // hook even though `prisma.auditLog` works from injected-instance
        // call sites. Routing the audit-row insert through
        // `$executeRaw` sidesteps the delegate-resolution path
        // entirely; the SQL maps 1:1 to the AuditLog Prisma model
        // (`audit_log` table, snake_case columns via `@map`).
        const diffJson = JSON.stringify(row.diff ?? {});
        const metadataJson = row.metadata !== null ? JSON.stringify(row.metadata) : null;
        await bareSelf.$executeRaw`
          INSERT INTO audit_log
            (id, tenant_id, actor_user_id, target_model, target_id, action, diff, metadata, created_at)
          VALUES
            (gen_random_uuid(),
             ${row.tenantId}::uuid,
             ${row.actorUserId}::uuid,
             ${row.targetModel},
             ${row.targetId},
             ${row.action}::audit_action,
             ${diffJson}::jsonb,
             ${metadataJson}::jsonb,
             now())
        `;
      },
      // Pre-read for the before-image. Uses `$queryRaw` against the
      // mapped table for the framework-managed default-auditable
      // models. We route around `bareClient()[delegateKey]` because
      // Prisma 7 + Nest's IoC wrapping mean the delegate accessors
      // are sometimes undefined inside our own methods (the Proxy
      // that surfaces them when injected callers access
      // `prisma.<model>` doesn't reach `this.<model>` from inside
      // the class). The framework-managed models all use a static
      // table name; project code that opts additional models in
      // either provides a custom `readBeforeImage` or overrides
      // `MODEL_TABLE_MAP` in their bootstrap.
      readBeforeImage: async (model, where) => {
        const tableName = MODEL_TABLE_MAP[model];
        if (!tableName) return null;
        const id = (where as { id?: unknown }).id;
        if (typeof id !== "string" || id.length === 0) return null;
        try {
          const rows = (await bareSelf.$queryRawUnsafe(
            `SELECT * FROM ${tableName} WHERE id = $1`,
            id,
          )) as Record<string, unknown>[];
          return rows[0] ?? null;
        } catch {
          return null;
        }
      },
      // Merge the framework-managed core models with any project-provided
      // extras. `CORE_AUDITABLE_MODELS` are always present; project code
      // extends the list via `{ provide: EXTRA_AUDITABLE_MODELS, useValue: [...] }`
      // (see prisma-tokens.ts). Anonymous-access models (Session, Account,
      // Verification — all Better-Auth internals) stay out of the
      // default; their churn doesn't carry compliance value and
      // would dwarf the audit-log volume.
      auditableModels: [...CORE_AUDITABLE_MODELS, ...this.extraAuditableModels],
    });

    // BlindIndex extension auto-populates `User.emailHash` on every
    // create/update through `prisma.client.user.*` (CF.SEC.03 iter-94).
    // No-op when `BLIND_INDEX_KEY` is unset (planner returns absent
    // → null blindIndex → extension trivial). Mounted last so the
    // hash reflects the email AFTER auditStamp / softDelete are
    // applied — they don't touch `email`, but the order keeps the
    // extension's writes on top of the chain.
    const blindIndexPlan = planBlindIndexFromEnv(process.env.BLIND_INDEX_KEY);
    const blindIndex: BlindIndex | null =
      blindIndexPlan.kind === "accepted" ? new BlindIndex({ key: blindIndexPlan.key }) : null;
    const userEmailBlindIndexExtension = buildUserEmailBlindIndexExtension(blindIndex);

    // versionBump auto-increments the `version` column on update for
    // ETag concurrency (CF.DATA.07). Default opt-in list is empty —
    // none of the framework-managed governance models declare a
    // `version` column today (adding it requires a migration + ETag
    // header consumers + Prisma client regen). Project code that
    // adds versioned resources extends this list via a config
    // override or builds its own extension chain.
    const versionBumpExtension = buildVersionBumpExtension({
      versionedModels: [],
    });

    // queryTracker pipes per-operation duration into the dev-portal
    // QueryBuffer (the same buffer the existing $on('query') listener
    // feeds with raw SQL durations — this layer adds the model +
    // operation labels Prisma's raw event lacks).
    const queryBuffer = getQueryBuffer();
    const queryTrackerExtension = buildQueryTrackerExtension({
      record: ({ model, operation, durationMs }) => {
        if (process.env.PRISMA_DISABLE_QUERY_BUFFER === "1") return;
        queryBuffer.record({
          sql: `${model}.${operation}`,
          durationMs,
          startedAtMs: Date.now() - Math.round(durationMs),
        });
      },
    });

    // fieldEncryptionExtension (CF.SEC.01 — iter-117): when
    // `FEATURE_FIELD_ENCRYPTION=true` AND `FIELD_ENCRYPTION_KEK` is
    // set, models listed in `FIELD_ENCRYPTION_MODEL_FIELDS` are
    // encrypted at write + decrypted at read. The extension is in
    // the chain unconditionally so the type alias stays stable; when
    // no fields are configured every operation passes through.
    const env = process.env as Record<string, string | undefined>;
    const envField = env.FIELD_ENCRYPTION_MODEL_FIELDS;
    const fieldEncryptionMap = parseFieldEncryptionMap(envField);
    const fieldEncryptionEnabled =
      env.FEATURE_FIELD_ENCRYPTION === "true" &&
      typeof env.FIELD_ENCRYPTION_KEK === "string" &&
      Object.keys(fieldEncryptionMap).length > 0;
    let fieldEncryptionExtension: ReturnType<typeof buildFieldEncryptionExtension> | null = null;
    if (fieldEncryptionEnabled) {
      // Iter-188: MultiKekFieldEncryption wraps the primary
      // EnvKekProvider. When `FIELD_ENCRYPTION_LEGACY_KEKS` is unset
      // the legacy array is empty and decrypt() only tries the primary
      // — byte-for-byte identical to the previous single-KEK path.
      // When operators stage a rotation by listing the prior KEK in
      // FIELD_ENCRYPTION_LEGACY_KEKS, the extension's decrypt path
      // tries the primary first then walks legacy KEKs in declaration
      // order so existing-row reads succeed without a re-encryption pass.
      const legacyKeks = parseLegacyKeks(env.FIELD_ENCRYPTION_LEGACY_KEKS);
      const multi = new MultiKekFieldEncryption({
        primary: new EnvKekProvider(env),
        legacy: legacyKeks.map<KekProvider>((buf) => ({ getKek: () => buf })),
      });
      fieldEncryptionExtension = buildFieldEncryptionExtension({
        modelFields: fieldEncryptionMap,
        encrypt: (plaintext) => multi.encrypt(plaintext),
        decrypt: (ciphertext) => multi.decrypt(ciphertext),
      });
    } else {
      // Identity passthrough — keeps the extension chain length
      // stable across configurations so the `ExtendedPrismaClient`
      // type alias matches in both modes.
      fieldEncryptionExtension = buildFieldEncryptionExtension({
        modelFields: {},
        encrypt: (plaintext) => plaintext,
        decrypt: (ciphertext) => ciphertext,
      });
    }

    const extended = this.$extends(uuidV7Extension)
      .$extends(auditStampExtension)
      .$extends(softDeleteExtension)
      .$extends(fieldEncryptionExtension)
      .$extends(versionBumpExtension)
      .$extends(auditExtension)
      .$extends(queryTrackerExtension)
      .$extends(userEmailBlindIndexExtension);
    return extended;
  }

  /**
   * Run a callback inside a Postgres transaction with `app.tenant_id`
   * set to the supplied tenant id (or the AsyncLocalStorage default).
   * RLS policies on tenant-scoped tables read the value via
   * `current_setting('app.tenant_id', true)`.
   *
   * Throws `RlsTenantMissingError` if no tenant id is resolvable.
   */
  async runWithRlsTenant<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    tenantId?: string,
  ): Promise<T> {
    const id = tenantId ?? getCurrentTenantId();
    if (!id) throw new RlsTenantMissingError();
    return this.$transaction(async (tx) => {
      // SET LOCAL only persists for the current transaction — the next
      // checkout from the connection pool sees a clean state.
      await tx.$executeRawUnsafe(`SET LOCAL "app.tenant_id" = '${escapeSqlString(id)}'`);
      return fn(tx);
    });
  }
}

export class RlsTenantMissingError extends Error {
  constructor() {
    super("runWithRlsTenant: no tenant id in scope (header missing or interceptor not registered)");
    this.name = "RlsTenantMissingError";
  }
}

/**
 * Defense in depth SQL escaping only.
 * UUID format is enforced upstream by parseTenantHeader(); this function
 * does NOT throw on non-UUID input — it only escapes single-quotes to
 * prevent SQL injection if a non-UUID value somehow reaches this path.
 */
function escapeSqlString(input: string): string {
  return input.replaceAll("'", "''");
}
