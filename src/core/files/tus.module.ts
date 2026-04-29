import { type DynamicModule, Logger, Module } from '@nestjs/common';
import { Server } from '@tus/server';
import { FileStore } from '@tus/file-store';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const TUS_PATH = '/files/upload';

/**
 * TusModule — mounts the `@tus/server` Server on `/files/upload`
 * (PLAN.md §32 Phase 4 — TUS Resumable-Upload).
 *
 * Storage: local filesystem under `${TMPDIR}/lt-tus` by default;
 * the `STORAGE_DEFAULT=s3` route uses an S3-backed store via the
 * `s3-storage-adapter` once that adapter is registered as a TUS
 * `DataStore`.
 *
 * The mount happens on the Express adapter via `app.use(TUS_PATH,
 * tusServer.handle.bind(tusServer))` — done in `bootstrap()` rather
 * than via NestJS controllers because TUS speaks raw HTTP semantics
 * (PATCH-with-byte-ranges) NestJS' DTO machinery doesn't model.
 */
@Module({})
export class TusModule {
  static forRoot(options?: { dataPath?: string }): DynamicModule {
    const dataPath = options?.dataPath ?? resolve(tmpdir(), 'lt-tus');
    const tusServer = new Server({
      path: TUS_PATH,
      datastore: new FileStore({ directory: dataPath }),
    });
    return {
      module: TusModule,
      providers: [
        { provide: 'TUS_SERVER', useValue: tusServer },
        { provide: 'TUS_PATH', useValue: TUS_PATH },
      ],
      exports: ['TUS_SERVER', 'TUS_PATH'],
    };
  }
}

/** Helper for `bootstrap()` to mount the TUS server. */
export function mountTus(
  expressApp: { use: (path: string, handler: unknown) => void },
  tusServer: Server,
  path: string,
): void {
  const logger = new Logger('TusUpload');
  expressApp.use(path, (req: unknown, res: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return tusServer.handle(req as any, res as any);
  });
  logger.log(`TUS upload endpoint mounted at ${path}`);
}
