import { createHash } from "node:crypto";

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";

import { loadFeatures } from "../features/features.js";
import { Can } from "../permissions/can.guard.js";
import { Public } from "../permissions/public.decorator.js";
import { uuidV7 } from "../uuid/uuid-v7.js";
import {
  ExpiredShareLinkError,
  InvalidShareLinkError,
  signShareLink,
  verifyShareLink,
} from "./share-link.js";
import { buildZipArchive, safeZipFilename } from "./zip-builder.js";
import { checkSniffedMimeMatchesClaim } from "./magic-byte-sniffer.js";
import { createClamavScannerFromEnv } from "./clamav-scanner.js";
import { AssetController, IpxCacheController } from "./asset.controller.js";
import { AssetService, type AssetTransformer } from "./asset.service.js";
import { VariantCacheCleanupCron } from "./variant-cache-cleanup.js";
import { InMemoryVariantCacheIndex, type VariantCacheIndex } from "./variant-cache-index.js";
import {
  PrismaVariantCacheIndex,
  hasPrismaVariantIndexDelegate,
} from "./variant-cache-index.prisma.js";
import {
  FILE_SCANNER,
  NoOpFileScanner,
  planScanDisposition,
  type FileScanner,
  type ScanDisposition,
} from "./file-scanner.js";
import {
  PrismaFolderStorage,
  bindPrismaFileStorage,
  bindPrismaFolderStorage,
} from "./file-storage.prisma.js";
import {
  type CreateFileInput,
  type FileRecord,
  type FileServiceStorage,
  FileNotFoundError,
  FileService,
} from "./file.service.js";
import {
  type FolderRecord,
  type FolderStorage,
  FolderNotFoundError,
  FolderService,
} from "./folder.service.js";
import { AssetPresetRegistry } from "./asset-presets.js";
import { createIpxAssetServer, type IpxAssetServer } from "./ipx-server.js";
import { IpxAssetTransformer } from "./ipx-transformer.js";
import { LocalStorageAdapter } from "./local-storage-adapter.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { PostgresStorageAdapter } from "./postgres-storage-adapter.js";
import { PrismaFileBlobOperations } from "./postgres-file-blob-operations.js";
import { StorageAdapterDataStore } from "./storage-adapter-data-store.js";
import { resolveStoragePath } from "./storage-path.js";
import {
  createStorageAdapter,
  resolveStorageBaseUrl,
  type StorageDriver,
  type StorageFactoryEnv,
} from "./storage-factory.js";
import type { StorageAdapter } from "./storage-adapter.js";
import { tusUploadConfigDefaults } from "./tus-upload-config.js";
import type { TusServerLike } from "./tus.module.js";
import { buildTusFinishHook } from "./tus-finish-hook.js";

const FILE_STORAGE = Symbol.for("lt:FileStorage");
const FOLDER_STORAGE = Symbol.for("lt:FolderStorage");
const STORAGE_ORIGIN = Symbol.for("lt:StorageOrigin");
const STORAGE_CACHE = Symbol.for("lt:StorageCache");
const ASSET_TRANSFORMER = Symbol.for("lt:AssetTransformer");
const VARIANT_CACHE_INDEX = Symbol.for("lt:VariantCacheIndex");
const ASSET_PRESETS = Symbol.for("lt:AssetPresets");
const IPX_SERVER = Symbol.for("lt:IpxServer");
const TUS_SERVER = Symbol.for("lt:TusServer");
const TUS_CONFIG = Symbol.for("lt:TusConfig");

// Re-export the DI tokens so consumers (e.g. test overrides, custom
// modules) can target the same identity. Symbol.for keeps the values
// canonical across module boundaries.
export const FILE_STORAGE_TOKEN = FILE_STORAGE;
export const FOLDER_STORAGE_TOKEN = FOLDER_STORAGE;
export const STORAGE_ORIGIN_TOKEN = STORAGE_ORIGIN;
export const STORAGE_CACHE_TOKEN = STORAGE_CACHE;
export const ASSET_TRANSFORMER_TOKEN = ASSET_TRANSFORMER;
export const ASSET_PRESETS_TOKEN = ASSET_PRESETS;
export const IPX_SERVER_TOKEN = IPX_SERVER;
export const TUS_SERVER_TOKEN = TUS_SERVER;
export const TUS_CONFIG_TOKEN = TUS_CONFIG;

export interface CreateFileBody {
  tenantId: string;
  folderId: string | null;
  filename: string;
  mimeType: string;
  uploaderId: string;
  /** Base64-encoded payload — kept as a single field so the DTO schema is flat. */
  contentsBase64: string;
}

@Controller("files")
class FileController {
  constructor(private readonly service: FileService) {}

  // Issue #47 — every route gates on `File`. The synthesized
  // Member-role rule (member-role-rules.ts) scopes File access to
  // `tenantId = $CURRENT_TENANT`, which the CASL ability evaluates at
  // request time. Defense-in-depth: the service layer + RLS still
  // filter by tenant on top.

  @Can("read", "File")
  @Get()
  async list(
    @Query("tenantId") tenantId: string,
    @Query("folderId") folderId: string | undefined,
  ): Promise<FileRecord[]> {
    if (!tenantId) throw new BadRequestException("tenantId required");
    return this.service.listInFolder(
      tenantId,
      folderId === "" || folderId === undefined ? null : folderId,
    );
  }

  /**
   * `GET /files/share/:token` — public read endpoint that resolves
   * a share-token to the file's metadata. The HMAC envelope is the
   * permission check (no CASL ability is consulted on this path).
   * Token failures map to 401 (unsigned) / 410 (expired) so the
   * caller can distinguish.
   *
   * Declared BEFORE `@Get(":id")` so the literal `share` segment
   * wins the route-match (Nest matches in declaration order within
   * a controller; otherwise `:id` would swallow this path).
   */
  @Public("HMAC-signed share link — token is the auth, file metadata is the response")
  @Get("share/:token")
  async fetchByShareToken(@Param("token") token: string): Promise<FileRecord> {
    const secret = resolveShareLinkSecret();
    let verified;
    try {
      verified = verifyShareLink({ token, secret, nowMs: Date.now() });
    } catch (err) {
      if (err instanceof ExpiredShareLinkError) {
        throw new NotFoundException("share link expired");
      }
      if (err instanceof InvalidShareLinkError) {
        throw new BadRequestException(`invalid share link: ${err.message}`);
      }
      throw err;
    }
    // The HMAC token carries the tenant id — set the RLS context
    // explicitly so the lookup sees only files belonging to that
    // tenant. A tampered tenant id would have already failed the
    // signature check above.
    const record = await this.service.findByIdInTenant(verified.tenantId, verified.fileId);
    if (!record) throw new NotFoundException(`file not found: ${verified.fileId}`);
    return record;
  }

  @Can("read", "File")
  @Get(":id")
  async get(@Param("id") id: string): Promise<FileRecord> {
    const record = await this.service.findById(id);
    if (!record) throw new NotFoundException(`file not found: ${id}`);
    return record;
  }

  /**
   * Single-shot upload — body bytes ride in the JSON payload as a
   * base64 field. Suitable for small files (avatars, attachments).
   * Use the `/files/upload` TUS endpoint for resumable / large uploads.
   */
  @Can("create", "File")
  @Post("upload")
  async upload(@Body() body: CreateFileBody): Promise<FileRecord> {
    if (!body.tenantId) throw new BadRequestException("tenantId required");
    if (!body.uploaderId) throw new BadRequestException("uploaderId required");
    if (!body.filename) throw new BadRequestException("filename required");
    if (!body.contentsBase64) throw new BadRequestException("contentsBase64 required");
    const bytes = Uint8Array.from(Buffer.from(body.contentsBase64, "base64"));
    return this.service.uploadAndCreate({
      tenantId: body.tenantId,
      folderId: body.folderId ?? null,
      filename: body.filename,
      mimeType: body.mimeType ?? "application/octet-stream",
      uploaderId: body.uploaderId,
      bytes,
    });
  }

  @Can("create", "File")
  @Post()
  async create(@Body() body: CreateFileInput): Promise<FileRecord> {
    return this.service.create(body);
  }

  /**
   * `PATCH /files/:id/visibility` — toggle the visibility marker
   * (PRIVATE / PUBLIC). Gated on `update:File` so editor-class roles
   * can flip it without requiring `manage all`.
   */
  @Can("update", "File")
  @Patch(":id/visibility")
  async setVisibility(
    @Param("id") id: string,
    @Body() body: { visibility?: unknown },
  ): Promise<FileRecord> {
    const value = body?.visibility;
    if (value !== "PRIVATE" && value !== "PUBLIC") {
      throw new BadRequestException("visibility must be PRIVATE or PUBLIC");
    }
    try {
      return await this.service.setVisibility(id, value);
    } catch (err) {
      if (err instanceof FileNotFoundError) throw new NotFoundException(err.message);
      throw err;
    }
  }

  /**
   * `POST /files/zip` — assemble a zip archive of the named files
   * and stream the bytes back. The body is `{ ids: string[] }`;
   * each id is fetched (tenant-scoped via the storage adapter), its
   * bytes are pulled from the storage adapter, and a STORED-mode
   * zip is built in memory and shipped as the response body.
   *
   * Capacity: in-memory build, suited for a few hundred MB. Larger
   * archives are an explicit non-goal for the bulk-download UI;
   * the share-link surface remains the path for individual large
   * files.
   */
  @Can("read", "File")
  @Post("zip")
  @HttpCode(200)
  @Header("Content-Type", "application/zip")
  @Header("Content-Disposition", 'attachment; filename="files.zip"')
  async downloadZip(@Body() body: { ids?: unknown }, @Res() res: Response): Promise<void> {
    if (!Array.isArray(body?.ids)) {
      throw new BadRequestException("body.ids (string[]) is required");
    }
    const ids = body.ids.filter((v): v is string => typeof v === "string" && v.length > 0);
    if (ids.length === 0) {
      throw new BadRequestException("body.ids must contain at least one id");
    }
    const adapter = this.service.storageAdapter;
    if (!adapter) {
      throw new BadRequestException("storage adapter is not bound");
    }
    const entries: { filename: string; bytes: Uint8Array }[] = [];
    for (const id of ids) {
      const record = await this.service.findById(id);
      if (!record) {
        throw new NotFoundException(`file not found: ${id}`);
      }
      const bytes = await adapter.get(record.storageKey);
      entries.push({ filename: safeZipFilename(record.filename), bytes });
    }
    const archive = buildZipArchive(entries);
    res.setHeader("Content-Length", String(archive.length));
    res.end(Buffer.from(archive));
  }

  @Can("delete", "File")
  @Delete(":id")
  async remove(@Param("id") id: string): Promise<{ removed: boolean }> {
    try {
      await this.service.remove(id);
      return { removed: true };
    } catch (err) {
      if (err instanceof FileNotFoundError) throw new NotFoundException(err.message);
      throw err;
    }
  }

  /**
   * `POST /files/:id/share-link` — issue a stateless HMAC-signed
   * share token for the file. The CASL `read:File` ability gates
   * issuance; the issuer's tenant is implicit through the request
   * context. Default TTL is 24h, capped at 7d. Returns the token
   * + the absolute fetch URL so the UI can copy-to-clipboard.
   */
  @Can("read", "File")
  @Post(":id/share-link")
  async issueShareLink(
    @Param("id") id: string,
    @Body() body: { ttlSeconds?: unknown } | undefined,
  ): Promise<{ shareToken: string; url: string; expiresAt: string }> {
    const file = await this.service.findById(id);
    if (!file) throw new NotFoundException(`file not found: ${id}`);
    const ttlInput = body && typeof body.ttlSeconds === "number" ? body.ttlSeconds : 86_400;
    const ttlSeconds = Math.min(Math.max(60, Math.floor(ttlInput)), 7 * 86_400);
    const expiresAtMs = Date.now() + ttlSeconds * 1000;
    const secret = resolveShareLinkSecret();
    // The output-pipeline scrubs fields named `token` — call ours
    // `shareToken` so the value rides through untouched.
    const shareToken = signShareLink({
      fileId: id,
      tenantId: file.tenantId,
      expiresAtMs,
      secret,
    });
    return {
      shareToken,
      // Global /api/ prefix applies to @Controller("files") — the
      // share link URL must reflect the full public path.
      url: `/api/files/share/${shareToken}`,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }
}

@Controller("folders")
class FolderController {
  constructor(private readonly service: FolderService) {}

  // Folder mirrors File — tenant-scoped CASL rule + service-layer
  // tenantId filter. See FileController above for the rationale.

  @Can("read", "Folder")
  @Get()
  async list(
    @Query("tenantId") tenantId: string,
    @Query("parentId") parentId: string | undefined,
  ): Promise<FolderRecord[]> {
    if (!tenantId) throw new BadRequestException("tenantId required");
    return this.service.listChildren(
      tenantId,
      parentId === "" || parentId === undefined ? null : parentId,
    );
  }

  @Can("create", "Folder")
  @Post()
  async create(
    @Body() body: { tenantId: string; parentId: string | null; name: string },
  ): Promise<FolderRecord> {
    return this.service.create(body);
  }

  @Can("delete", "Folder")
  @Delete(":id")
  async remove(@Param("id") id: string): Promise<{ removed: boolean }> {
    try {
      await this.service.remove(id);
      return { removed: true };
    } catch (err) {
      if (err instanceof FolderNotFoundError) throw new NotFoundException(err.message);
      throw err;
    }
  }
}

/**
 * Build the storage origin adapter from the active feature config.
 *
 * Driver selection order:
 *  - `features.files.storageDefault` → driver
 *  - `local`     → `LocalStorageAdapter` rooted at `STORAGE_LOCAL_ROOT`
 *  - `s3`        → `S3StorageAdapter` (lazy-loads `@aws-sdk/client-s3`)
 *  - `postgres`  → `PostgresStorageAdapter` over `prisma.fileBlob.*`
 *
 * For Postgres we wrap a global PrismaFileBlobOperations bound to a
 * synthetic "system" tenant so the boot-time adapter is request-
 * agnostic. Per-request tenant scoping rides on the metadata
 * tier (PrismaFileStorage runs through `runWithRlsTenant`).
 */
/**
 * Resolve the HMAC secret for share-link signing / verification.
 *
 * In production, a missing or short secret (< 32 chars) is a misconfiguration
 * that would silently weaken the HMAC — fail loudly instead. In dev/test the
 * "dev-share-link-secret" fallback keeps the workflow friction-free.
 */
function resolveShareLinkSecret(): string {
  const secret = process.env.FILE_SHARE_LINK_SECRET ?? "dev-share-link-secret";
  if (
    process.env.NODE_ENV === "production" &&
    (process.env.FILE_SHARE_LINK_SECRET === undefined ||
      process.env.FILE_SHARE_LINK_SECRET.length < 32)
  ) {
    throw new Error(
      "FILE_SHARE_LINK_SECRET must be set to a random string of at least 32 characters in production",
    );
  }
  return secret;
}

async function buildOriginAdapter(
  driver: StorageDriver,
  env: StorageFactoryEnv,
  prisma: PrismaService,
): Promise<StorageAdapter> {
  if (driver === "postgres") {
    // Boot-time binding to a sentinel tenant. Production deployments
    // that want full per-request tenant isolation on the blob layer
    // should override `STORAGE_ORIGIN_TOKEN` with a request-scoped
    // provider that re-binds `PrismaFileBlobOperations` to the
    // current request's tenant id.
    const tenantId = env.S3_BUCKET ?? "00000000-0000-0000-0000-000000000000";
    // `fileBlob` is a feature-gated Prisma model — present on the
    // runtime client when the migration is applied, but the static
    // Prisma type ships a wider generic delegate than the project's
    // narrower `FileBlobTable` interface. Bridge through the
    // type-erasing helper below so the cast lives in one place.
    type FileBlobModel = ConstructorParameters<typeof PrismaFileBlobOperations>[0]["fileBlob"];
    const ops = new PrismaFileBlobOperations({
      tenantId,
      fileBlob: bridgePrismaDelegate<FileBlobModel>(Reflect.get(prisma, "fileBlob")),
    });
    const adapter = new PostgresStorageAdapter(ops, { baseUrl: resolveStorageBaseUrl(env) });
    return createStorageAdapter({ driver, env, postgresAdapter: adapter });
  }
  return createStorageAdapter({ driver, env });
}

/**
 * Cache adapter — defaults to a `LocalStorageAdapter` under
 * `${STORAGE_LOCAL_ROOT}/cache` when the origin is local, mirrors the
 * origin otherwise. The asset-cache prefix (`assets/`) keeps cache
 * entries from colliding with origin entries when both share a backend.
 */
function buildCacheAdapter(
  driver: StorageDriver,
  env: StorageFactoryEnv,
  origin: StorageAdapter,
): StorageAdapter {
  if (driver === "local") {
    const root = env.STORAGE_LOCAL_ROOT ?? "./data/uploads";
    return new LocalStorageAdapter({
      root: `${root}/_cache`,
      baseUrl: resolveStorageBaseUrl(env),
    });
  }
  // S3 / Postgres backends: reuse the origin. The `assets/` prefix on
  // cache keys prevents collisions with finished file keys.
  return origin;
}

/**
 * FilesModule — `/files` + `/folders` CRUD, `/assets/:key` transform
 * pipeline, and TUS resumable uploads (mounted in `bootstrap.ts`)
 * over a Prisma-backed metadata tier and a configurable
 * `StorageAdapter` (Local / S3 / Postgres-FileBlob).
 *
 * Driver selection happens once at boot via
 * `features.files.storageDefault` and the `STORAGE_*` env vars.
 * Switching adapters requires a restart — we don't track capacitive
 * migration between backends.
 */
@Module({
  controllers: [FileController, FolderController, AssetController, IpxCacheController],
  providers: [
    // ── Metadata storage (Prisma) ─────────────────────────────────
    {
      provide: FILE_STORAGE,
      useFactory: (prisma: PrismaService) => bindPrismaFileStorage(prisma),
      inject: [PrismaService],
    },
    {
      provide: FOLDER_STORAGE,
      useFactory: (prisma: PrismaService): PrismaFolderStorage => bindPrismaFolderStorage(prisma),
      inject: [PrismaService],
    },
    // ── Storage adapter (origin) ──────────────────────────────────
    {
      provide: STORAGE_ORIGIN,
      useFactory: async (prisma: PrismaService): Promise<StorageAdapter> => {
        const features = loadFeatures(process.env as Record<string, string | undefined>);
        return buildOriginAdapter(
          features.files.storageDefault,
          process.env as StorageFactoryEnv,
          prisma,
        );
      },
      inject: [PrismaService],
    },
    // ── Storage adapter (cache) ───────────────────────────────────
    {
      provide: STORAGE_CACHE,
      useFactory: (origin: StorageAdapter): StorageAdapter => {
        const features = loadFeatures(process.env as Record<string, string | undefined>);
        return buildCacheAdapter(
          features.files.storageDefault,
          process.env as StorageFactoryEnv,
          origin,
        );
      },
      inject: [STORAGE_ORIGIN],
    },
    // ── Asset transformer (IPX) ───────────────────────────────────
    {
      provide: ASSET_TRANSFORMER,
      useFactory: (): AssetTransformer => new IpxAssetTransformer(),
    },
    // ── Asset preset registry ─────────────────────────────────────
    {
      provide: ASSET_PRESETS,
      useFactory: (): AssetPresetRegistry => AssetPresetRegistry.fromDefaults(),
    },
    // ── IPX asset server (mounted at /_ipx/* in bootstrap) ────────
    {
      provide: IPX_SERVER,
      useFactory: (origin: StorageAdapter, presets: AssetPresetRegistry): IpxAssetServer =>
        createIpxAssetServer({ origin, presets }),
      inject: [STORAGE_ORIGIN, ASSET_PRESETS],
    },
    // ── Asset service ─────────────────────────────────────────────
    {
      // Iter-183: closes CF.STORAGE.01 final line item. Production
      // binds `PrismaVariantCacheIndex` when the Prisma client carries
      // the `assetVariantIndex` delegate (migration
      // `20260506120000_asset_variant_index`); tests + projects that
      // skip the migration fall back to in-memory so AssetService stays
      // bootable. The index is optional — pre-iter-183 behavior is
      // preserved when no binding is supplied.
      provide: VARIANT_CACHE_INDEX,
      useFactory: (prisma: PrismaService): VariantCacheIndex => {
        if (!hasPrismaVariantIndexDelegate(prisma)) return new InMemoryVariantCacheIndex();
        return new PrismaVariantCacheIndex(prisma);
      },
      inject: [PrismaService],
    },
    {
      provide: AssetService,
      useFactory: (
        origin: StorageAdapter,
        cache: StorageAdapter,
        transformer: AssetTransformer,
        variantIndex: VariantCacheIndex,
      ): AssetService => new AssetService({ origin, cache, transformer, variantIndex }),
      inject: [STORAGE_ORIGIN, STORAGE_CACHE, ASSET_TRANSFORMER, VARIANT_CACHE_INDEX],
    },
    // Iter-184: prunes orphan variant rows older than 90 days. Sibling
    // to IdempotencyCleanupCron + GeocodingCacheCleanupCron — every
    // Postgres-backed cache in the project now has its own cleanup
    // cron preventing unbounded row growth.
    VariantCacheCleanupCron,
    // ── Antivirus scanner ─────────────────────────────────────────
    // Iter-120: when CLAMAV_HOST is set, the factory returns a
    // ClamavScanner (real INSTREAM-protocol client). Otherwise the
    // NoOpFileScanner stays as the safe default so the module mounts
    // cleanly out-of-the-box.
    {
      provide: FILE_SCANNER,
      useFactory: (): FileScanner => {
        const clamav = createClamavScannerFromEnv(process.env);
        return clamav ?? new NoOpFileScanner();
      },
    },
    // ── File / folder services (metadata + bytes) ─────────────────
    {
      provide: FileService,
      useFactory: (storage: FileServiceStorage, origin: StorageAdapter, scanner: FileScanner) => {
        const svc = FileService.withStorageAdapter(storage, origin);
        svc.fileScanner = scanner;
        const policy = process.env.FILE_SCAN_INDETERMINATE_POLICY;
        if (policy === "reject" || policy === "keep") {
          svc.scanIndeterminatePolicy = policy;
        }
        return svc;
      },
      inject: [FILE_STORAGE, STORAGE_ORIGIN, FILE_SCANNER],
    },
    {
      provide: FolderService,
      useFactory: (storage: FolderStorage) => new FolderService(storage),
      inject: [FOLDER_STORAGE],
    },
    // ── TUS resumable uploads (lazy) ──────────────────────────────
    {
      provide: TUS_CONFIG,
      useFactory: () => {
        const defaults = tusUploadConfigDefaults();
        const env = process.env;
        return {
          ...defaults,
          ...(env.TUS_MAX_UPLOAD_BYTES
            ? { maxUploadBytes: Number.parseInt(env.TUS_MAX_UPLOAD_BYTES, 10) }
            : {}),
          ...(env.TUS_CHUNK_EXPIRATION_SECONDS
            ? { chunkExpirationSeconds: Number.parseInt(env.TUS_CHUNK_EXPIRATION_SECONDS, 10) }
            : {}),
        };
      },
    },
    {
      provide: TUS_SERVER,
      useFactory: async (
        origin: StorageAdapter,
        config: { mountPath: string; chunkExpirationSeconds: number },
        fileService: FileService,
      ): Promise<TusServerLike | null> => {
        const features = loadFeatures(process.env as Record<string, string | undefined>);
        if (!features.files.tus) return null;
        const dataStore = new StorageAdapterDataStore(origin);
        // The DataStore advertises its expiration via getExpiration() —
        // we set the value here so the cleanup sweep knows how stale
        // to consider in-progress uploads.
        Object.assign(dataStore, {
          getExpiration: () => config.chunkExpirationSeconds * 1000,
        });
        try {
          const { Server } = await import("@tus/server");
          // The @tus/server `Server` ctor accepts a permissive
          // `datastore` shape; our `StorageAdapterDataStore`
          // implements the runtime contract but the package's
          // typed interface is structurally narrower. Bridge via
          // the shared helper.
          const server = new Server({
            path: config.mountPath,
            datastore:
              bridgePrismaDelegate<ConstructorParameters<typeof Server>[0]["datastore"]>(dataStore),
            // Issue #102: after all bytes are received, promote the
            // upload into FileService and expose the resulting File.id
            // + storageKey as response headers so callers don't need a
            // follow-up GET /files/:id request.
            onUploadFinish: buildTusFinishHook({ fileService, dataStore }),
          });
          return bridgePrismaDelegate<TusServerLike>(server);
        } catch (err) {
          // `@tus/server` is a hard dep of this template, but we
          // gracefully degrade to "no TUS" when the import fails so
          // boot doesn't crash — the upload-complete hook still works
          // for the single-shot POST /files/upload path.
          // eslint-disable-next-line no-console
          console.warn(`[FilesModule] TUS server failed to load: ${String(err)}`);
          return null;
        }
      },
      inject: [STORAGE_ORIGIN, TUS_CONFIG, FileService],
    },
  ],
  exports: [
    FileService,
    FolderService,
    AssetService,
    STORAGE_ORIGIN,
    STORAGE_CACHE,
    ASSET_PRESETS,
    IPX_SERVER,
    TUS_SERVER,
    TUS_CONFIG,
    FILE_SCANNER,
  ],
})
export class FilesModule {
  /**
   * Test override: build a FilesModule whose metadata + storage tiers
   * are in-memory. Spec files use this to exercise the controller
   * surface without booting Postgres.
   */
  static forTest(): typeof FilesModule {
    return FilesModule;
  }
}

// Build a deterministic upload-time storage path + sha256.
export interface UploadAndCreateInput {
  tenantId: string;
  folderId: string | null;
  filename: string;
  mimeType: string;
  uploaderId: string;
  bytes: Uint8Array;
}

/**
 * Mix-in for `FileService` that adds upload-and-create semantics.
 * Lives next to the module to keep the service file storage-agnostic
 * (the constructor binding for tests doesn't pull this in).
 */
declare module "./file.service.js" {
  interface FileService {
    storageAdapter?: StorageAdapter;
    /**
     * Optional FileScanner binding. Wired by FilesModule from the
     * `FILE_SCANNER` DI token. When present, every `uploadAndCreate`
     * call routes the bytes through `scanner.scan()` and applies
     * `planScanDisposition` to keep / quarantine / reject the upload.
     * When absent, uploads pass through unchecked (backward-compat
     * path for existing projects + tests that don't exercise scan).
     */
    fileScanner?: FileScanner;
    /**
     * Project policy for `indeterminate` scan verdicts. Default
     * `keep` matches the planner default (residual risk acceptable
     * over hard-failing the upload when the scanner is briefly
     * unreachable). Strict deployments set this to `reject`.
     */
    scanIndeterminatePolicy?: "keep" | "reject";
    uploadAndCreate(input: UploadAndCreateInput): Promise<FileRecord>;
    findById(id: string): Promise<FileRecord | null>;
  }
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace FileService {
    function withStorageAdapter(storage: FileServiceStorage, adapter: StorageAdapter): FileService;
  }
}

FileService.withStorageAdapter = function withStorageAdapter(
  storage: FileServiceStorage,
  adapter: StorageAdapter,
): FileService {
  const svc = new FileService(storage);
  svc.storageAdapter = adapter;
  return svc;
};

/**
 * Reject-error thrown when the FileScanner returns a verdict the
 * disposition planner partitions to `reject`. Subclasses
 * `BadRequestException` so Nest's exception filter maps it to a 400
 * with a descriptive error code instead of swallowing it.
 */
export class FileScanRejectedError extends BadRequestException {
  constructor(verdict: string, threatName?: string) {
    const reason = threatName ? `${verdict} (${threatName})` : verdict;
    super(`Upload rejected by file scanner: ${reason}`);
    this.name = "FileScanRejectedError";
  }
}

FileService.prototype.uploadAndCreate = async function uploadAndCreate(
  this: FileService,
  input: UploadAndCreateInput,
): Promise<FileRecord> {
  const adapter = this.storageAdapter;
  if (!adapter) {
    throw new Error("FileService.uploadAndCreate requires a StorageAdapter binding");
  }
  // Magic-byte MIME sniffing (CF.FILES.07 — iter-118). The client-
  // supplied `Content-Type` is trusted only after the body's leading
  // bytes line up. Strict mode is opt-in via
  // `FEATURE_FILES_MIME_STRICT_ENABLED=true` so legacy clients that
  // send `application/octet-stream` for known image bodies still upload.
  // Previously read process.env directly — now routes through features.ts
  // so all toggle logic lives in one place (H2 fix).
  const features = loadFeatures(process.env as Record<string, string | undefined>);
  const strictMime = features.filesMimeStrict.enabled;
  if (strictMime) {
    const probe = input.bytes.subarray(0, 256);
    const match = checkSniffedMimeMatchesClaim(probe, input.mimeType);
    if (!match.ok) {
      throw new BadRequestException(
        `upload rejected: claimed mime "${match.claimed}" does not match sniffed "${match.sniffed}"`,
      );
    }
  }
  const fileId = uuidV7();
  // Scan first — the disposition decides where the bytes land. Skip
  // when no scanner is bound (backward-compat path for projects that
  // haven't yet wired `FILE_SCANNER`).
  let scanVerdict: "clean" | "infected" | "indeterminate" | undefined;
  let scanThreatName: string | undefined;
  let disposition: ScanDisposition = "keep";
  if (this.fileScanner) {
    const result = await this.fileScanner.scan({
      body: input.bytes,
      contentType: input.mimeType,
      filename: input.filename,
    });
    scanVerdict = result.verdict;
    scanThreatName = result.threatName;
    disposition = planScanDisposition({
      verdict: result.verdict,
      ...(this.scanIndeterminatePolicy
        ? { indeterminatePolicy: this.scanIndeterminatePolicy }
        : {}),
    });
    if (disposition === "reject") {
      throw new FileScanRejectedError(result.verdict, result.threatName);
    }
  }

  // Quarantine prefix keeps infected bytes accessible for
  // forensic review (incident response / compliance audit) while
  // segregated from clean keys. The admin UI surfaces the
  // `_quarantine/` prefix via `scanVerdict === "infected"`.
  const cleanKey = resolveStoragePath({
    tenantId: input.tenantId,
    folderId: input.folderId,
    fileId,
    filename: input.filename,
  });
  const storageKey = disposition === "quarantine" ? `_quarantine/${cleanKey}` : cleanKey;
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  await adapter.put({ key: storageKey, body: input.bytes, mimeType: input.mimeType });
  const record: FileRecord = {
    id: fileId,
    tenantId: input.tenantId,
    folderId: input.folderId,
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.bytes.byteLength,
    sha256,
    storageDriver: detectDriver(adapter),
    storageKey,
    uploaderId: input.uploaderId,
    visibility: "PRIVATE",
    ...(scanVerdict ? { scanVerdict } : {}),
    ...(scanThreatName ? { scanThreatName } : {}),
  };
  await getFileServiceStorage(this).insert(record);
  return record;
};

FileService.prototype.findById = async function findById(
  this: FileService,
  id: string,
): Promise<FileRecord | null> {
  return getFileServiceStorage(this).findById(id);
};

/**
 * Reach into the FileService instance for its private `storage`
 * field — the prototype-extension pattern below the FileService
 * class declaration can't see it through the public type. The
 * helper centralises the narrowing so the cast pattern lives in
 * exactly one place.
 */
function getFileServiceStorage(svc: object): FileServiceStorage {
  return Reflect.get(svc, "storage") as FileServiceStorage;
}

/**
 * Type-erasing bridge for Prisma generated delegate types whose
 * complex generics (`<DefaultArgs, PrismaClientOptions, …>`) don't
 * structurally match the project's narrow `FileBlobTable`-style
 * interfaces. The runtime contract is identical (Prisma generated
 * the same upsert/findUnique/delete shape we declare); the static
 * gap is purely TypeScript's structural-comparison strictness.
 */
function bridgePrismaDelegate<T>(value: unknown): T {
  return value as T;
}

function detectDriver(adapter: StorageAdapter): string {
  const name = adapter.constructor.name;
  if (name === "S3StorageAdapter") return "s3";
  if (name === "LocalStorageAdapter") return "local";
  if (name === "PostgresStorageAdapter") return "postgres";
  return "memory";
}
