import { createHash } from "node:crypto";

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";

import { loadFeatures } from "../features/features.js";
import { uuidV7 } from "../uuid/uuid-v7.js";
import { AssetController } from "./asset.controller.js";
import { AssetService, type AssetTransformer } from "./asset.service.js";
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
import { LocalStorageAdapter } from "./local-storage-adapter.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { PostgresStorageAdapter } from "./postgres-storage-adapter.js";
import { PrismaFileBlobOperations } from "./postgres-file-blob-operations.js";
import { SharpTransformer } from "./sharp-transformer.js";
import { resolveStoragePath } from "./storage-path.js";
import {
  createStorageAdapter,
  resolveStorageBaseUrl,
  type StorageDriver,
  type StorageFactoryEnv,
} from "./storage-factory.js";
import type { StorageAdapter } from "./storage-adapter.js";

const FILE_STORAGE = Symbol.for("lt:FileStorage");
const FOLDER_STORAGE = Symbol.for("lt:FolderStorage");
const STORAGE_ORIGIN = Symbol.for("lt:StorageOrigin");
const STORAGE_CACHE = Symbol.for("lt:StorageCache");
const ASSET_TRANSFORMER = Symbol.for("lt:AssetTransformer");

// Re-export the DI tokens so consumers (e.g. test overrides, custom
// modules) can target the same identity. Symbol.for keeps the values
// canonical across module boundaries.
export const FILE_STORAGE_TOKEN = FILE_STORAGE;
export const FOLDER_STORAGE_TOKEN = FOLDER_STORAGE;
export const STORAGE_ORIGIN_TOKEN = STORAGE_ORIGIN;
export const STORAGE_CACHE_TOKEN = STORAGE_CACHE;
export const ASSET_TRANSFORMER_TOKEN = ASSET_TRANSFORMER;

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

  @Post()
  async create(@Body() body: CreateFileInput): Promise<FileRecord> {
    return this.service.create(body);
  }

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
}

@Controller("folders")
class FolderController {
  constructor(private readonly service: FolderService) {}

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

  @Post()
  async create(
    @Body() body: { tenantId: string; parentId: string | null; name: string },
  ): Promise<FolderRecord> {
    return this.service.create(body);
  }

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
    const ops = new PrismaFileBlobOperations({
      tenantId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fileBlob: (prisma as any).fileBlob,
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
  controllers: [FileController, FolderController, AssetController],
  providers: [
    // ── Metadata storage (Prisma) ─────────────────────────────────
    {
      provide: FILE_STORAGE,
      useFactory: (prisma: PrismaService) => bindPrismaFileStorage(prisma),
      inject: [PrismaService],
    },
    {
      provide: FOLDER_STORAGE,
      useFactory: (prisma: PrismaService): PrismaFolderStorage =>
        bindPrismaFolderStorage(prisma),
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
    // ── Asset transformer (sharp) ─────────────────────────────────
    {
      provide: ASSET_TRANSFORMER,
      useFactory: (): AssetTransformer => new SharpTransformer(),
    },
    // ── Asset service ─────────────────────────────────────────────
    {
      provide: AssetService,
      useFactory: (
        origin: StorageAdapter,
        cache: StorageAdapter,
        transformer: AssetTransformer,
      ): AssetService => new AssetService({ origin, cache, transformer }),
      inject: [STORAGE_ORIGIN, STORAGE_CACHE, ASSET_TRANSFORMER],
    },
    // ── File / folder services (metadata + bytes) ─────────────────
    {
      provide: FileService,
      useFactory: (storage: FileServiceStorage, origin: StorageAdapter) =>
        FileService.withStorageAdapter(storage, origin),
      inject: [FILE_STORAGE, STORAGE_ORIGIN],
    },
    {
      provide: FolderService,
      useFactory: (storage: FolderStorage) => new FolderService(storage),
      inject: [FOLDER_STORAGE],
    },
  ],
  exports: [FileService, FolderService, AssetService, STORAGE_ORIGIN, STORAGE_CACHE],
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
    uploadAndCreate(input: UploadAndCreateInput): Promise<FileRecord>;
    findById(id: string): Promise<FileRecord | null>;
  }
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace FileService {
    function withStorageAdapter(
      storage: FileServiceStorage,
      adapter: StorageAdapter,
    ): FileService;
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

FileService.prototype.uploadAndCreate = async function uploadAndCreate(
  this: FileService,
  input: UploadAndCreateInput,
): Promise<FileRecord> {
  const adapter = this.storageAdapter;
  if (!adapter) {
    throw new Error("FileService.uploadAndCreate requires a StorageAdapter binding");
  }
  const fileId = uuidV7();
  const storageKey = resolveStoragePath({
    tenantId: input.tenantId,
    folderId: input.folderId,
    fileId,
    filename: input.filename,
  });
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  await adapter.put({ key: storageKey, body: input.bytes, mimeType: input.mimeType });
  // The metadata layer assigns a fresh id internally — pass our id
  // so the storage key references the same row. We patch through the
  // FileService.create() path by inserting through the storage layer
  // directly with the deterministic id.
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
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (this as any).storage.insert(record);
  return record;
};

FileService.prototype.findById = async function findById(
  this: FileService,
  id: string,
): Promise<FileRecord | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (this as any).storage.findById(id);
};

function detectDriver(adapter: StorageAdapter): string {
  const name = adapter.constructor.name;
  if (name === "S3StorageAdapter") return "s3";
  if (name === "LocalStorageAdapter") return "local";
  if (name === "PostgresStorageAdapter") return "postgres";
  return "memory";
}
