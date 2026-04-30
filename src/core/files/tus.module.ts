import { type DynamicModule, Logger, Module } from "@nestjs/common";
import type { Request, Response } from "express";

import { StorageAdapterDataStore } from "./storage-adapter-data-store.js";
import { type TusUploadConfig, tusUploadConfigDefaults } from "./tus-upload-config.js";
import type { StorageAdapter } from "./storage-adapter.js";

const TUS_SERVER_TOKEN = "TUS_SERVER";
const TUS_PATH_TOKEN = "TUS_PATH";

/**
 * TusModule — mounts the `@tus/server` Server on
 * `tusUploadConfigDefaults().mountPath` (`/api/files/upload`) by
 * default.
 *
 * Storage: forwards onto the configured `StorageAdapter` via
 * `StorageAdapterDataStore` — the same backend that finished files
 * persist into. Switching adapters (S3 / Local / Postgres-FileBlob)
 * thus also switches the in-progress chunk store automatically.
 *
 * Quota:
 *   - `TUS_MAX_UPLOAD_BYTES` caps a single upload (default 50 MB).
 *   - `TUS_MAX_BYTES_PER_TENANT` caps the sum of in-progress uploads
 *     for one tenant (optional; off when unset).
 *   - `TUS_CHUNK_EXPIRATION_SECONDS` controls how long abandoned
 *     resumable uploads survive before the cleanup sweep purges them
 *     (Issue #15 schedule). The data store's `deleteExpired()` reads
 *     this value via `getExpiration()`.
 *
 * Mounting happens in `bootstrap.ts` via `mountTus()` because TUS
 * speaks raw HTTP semantics (PATCH-with-byte-ranges) NestJS' DTO
 * machinery doesn't model.
 */
@Module({})
export class TusModule {
  static forRoot(options: TusModuleForRootOptions): DynamicModule {
    const config = { ...tusUploadConfigDefaults(), ...options.config };
    const dataStore = new StorageAdapterDataStore(options.storageAdapter);
    // The `@tus/server` v3 binding lives behind a lazy import so the
    // `forRoot` call stays sync. The actual import happens inside the
    // factory below, called by Nest at module-init time.
    const serverFactory = async (): Promise<TusServerLike> => {
      const { Server } = await import("@tus/server");
      // The DataStore advertises its own expiration via
      // `getExpiration()` — return milliseconds per the @tus
      // convention so cleanup sweeps know how stale to consider
      // in-progress uploads.
      Object.assign(dataStore, {
        getExpiration: () => config.chunkExpirationSeconds * 1000,
      });
      const server: TusServerLike = new Server({
        path: config.mountPath,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        datastore: dataStore as any,
      });
      return server;
    };
    return {
      module: TusModule,
      providers: [
        {
          provide: TUS_SERVER_TOKEN,
          useFactory: serverFactory,
        },
        { provide: TUS_PATH_TOKEN, useValue: config.mountPath },
        { provide: "TUS_CONFIG", useValue: config },
      ],
      exports: [TUS_SERVER_TOKEN, TUS_PATH_TOKEN, "TUS_CONFIG"],
    };
  }
}

export interface TusModuleForRootOptions {
  storageAdapter: StorageAdapter;
  config?: Partial<TusUploadConfig>;
}

/** Loose shape covering what `mountTus()` needs from the TUS server. */
export interface TusServerLike {
  handle(req: Request, res: Response): Promise<void> | void;
}

/**
 * Helper for `bootstrap()` to mount the TUS server on the Express
 * adapter. The handler delegates to `tusServer.handle` for every HTTP
 * method TUS supports (POST/HEAD/PATCH/DELETE/OPTIONS).
 */
export function mountTus(
  expressApp: { use: (path: string, handler: unknown) => void },
  tusServer: TusServerLike,
  path: string,
): void {
  const logger = new Logger("TusUpload");
  expressApp.use(path, (req: Request, res: Response) => {
    return tusServer.handle(req, res);
  });
  logger.log(`TUS upload endpoint mounted at ${path}`);
}
