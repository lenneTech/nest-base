# CLAUDE.md — `src/core/files/`

This folder is the **file storage subsystem** — metadata tier, object
storage adapters, asset transforms, and TUS resumable uploads. Three
layers, all swap-out-able:

```
                  HTTP
                    │
   ┌────────────────┼─────────────────────────────────────┐
   │                │                                     │
   FileController   AssetController     /_ipx/* (Nuxt-Image)
   POST /files/upload     GET /assets/:key   /api/files/upload
   GET  /files/:id        + cache adapter   (TUS @PATCH/HEAD/POST/DELETE)
   DELETE …               IpxCacheController
   │                      DELETE /_ipx/cache/:key         │
   FileService      AssetService                         TUS Server (lazy)
   FolderService    │  │  │                              │
   │   │            │  │  └─→ Cache adapter ─────────────┤
   │   │            │  └─→ Origin adapter ───────────────┤
   │   │            └─→ IpxAssetTransformer (createIPX)  │
   │   │                                                 │
   │   │            IpxAssetServer ─→ createIPXNodeServer
   │   │            (mounted on Express by bootstrap.ts)
   │   │                                                 │
   PrismaFileStorage  ←——————————————————————————————→ StorageAdapterDataStore
   PrismaFolderStorage                                    │
   │                                                      │
   PrismaService                                          StorageAdapter (origin)
   prisma.file / .folder                                  LocalStorageAdapter |
                                                          S3StorageAdapter |
                                                          PostgresStorageAdapter
```

## Driver matrix

`FEATURE_FILES_STORAGE_DEFAULT` selects the origin adapter at boot:

| Driver     | Adapter                                        | Backing                               | Default | When to use                        |
| ---------- | ---------------------------------------------- | ------------------------------------- | ------- | ---------------------------------- |
| `local`    | `LocalStorageAdapter`                          | filesystem under `STORAGE_LOCAL_ROOT` | ✅      | dev, single-host deploys           |
| `s3`       | `S3StorageAdapter` (lazy `@aws-sdk/client-s3`) | RustFS / AWS / Cloudflare R2 / B2     |         | prod, multi-region                 |
| `postgres` | `PostgresStorageAdapter`                       | `prisma.fileBlob`                     |         | small files (≤ 1 MB), no S3 needed |

The default is `local` so a fresh template runs without an S3 bucket.
Switching drivers requires a restart — we don't track capacitive
migration between backends.

The cache adapter (used by `AssetService` for transformed asset
bytes) defaults to a `LocalStorageAdapter` rooted at `${STORAGE_LOCAL_ROOT}/_cache`
when origin=local; otherwise it reuses the origin (the `assets/`
prefix on cache keys keeps them out of the way of finished file keys).

## Metadata persistence

`PrismaFileStorage` + `PrismaFolderStorage` (in `file-storage.prisma.ts`)
implement `FileServiceStorage` / `FolderStorage` against the existing
`File` / `Folder` Prisma models. Soft-delete via `deletedAt`. Tenant
isolation rides through `runWithRlsTenant()` so the project's RLS
policies double-down on every read.

## TUS resumable uploads

`StorageAdapterDataStore` adapts a `StorageAdapter` to the
`@tus/server` `DataStore` interface. Resumable uploads land under the
`_tus/` prefix on whichever backend is configured; the upload-complete
hook moves the bytes to the final `<tenant>/<folder>/<id>-<filename>`
key. Stale resumable uploads are purged via the cron in Issue #15
(`chunkExpirationSeconds` config).

| Env var                        | Default | Notes                           |
| ------------------------------ | ------- | ------------------------------- |
| `FEATURE_FILES_TUS`            | `true`  | Set to `false` to mount nothing |
| `TUS_MAX_UPLOAD_BYTES`         | 50 MB   | Hard cap per single upload      |
| `TUS_MAX_BYTES_PER_TENANT`     | unset   | Optional total per-tenant quota |
| `TUS_CHUNK_EXPIRATION_SECONDS` | 86_400  | Stale-chunk sweep TTL           |

**Postgres-backend caveat.** TUS chunks are HTTP-PATCH-shaped — every
PATCH is a full body rewrite at the moment (the StorageAdapter
contract is byte-buffer shaped, not stream-shaped). The Postgres
backend pays a row-rewrite per chunk; works, but is **slow** for
large files. Switch to `local` or `s3` when uploads exceed a few MB.

## Asset pipeline

Two URL surfaces share the same engine:

1. `/_ipx/<modifiers>/<source>` — Nuxt-Image-compatible. Mounted by
   `bootstrap.ts` as a raw Node listener (h3 → Node) wrapping
   `createIPX({ storage: storageAdapterSource(adapter) })`. The
   `ipx-server.ts` middleware also rewrites a leading
   `/preset_<name>/<source>` segment to the preset's full IPX
   modifier string before delegating. Frontend setup guide:
   [`docs/integrations/nuxt-image.md`](../../../docs/integrations/nuxt-image.md).
2. `/assets/:key?width=…&format=…` — legacy URL contract preserved
   for backward compat. The controller still probes the cache
   adapter, emits `x-cache: HIT|MISS|BYPASS`, then delegates to
   `AssetService.deliver(key, options)` which routes through the
   `IpxAssetTransformer` (a thin `createIPX()` wrapper sharing the
   same engine as the URL endpoint).

`DELETE /_ipx/cache/:sourcePath` cascades through the variant-cache
index (`AssetVariantIndex`, iter-183): `AssetService.invalidateSource`
queries the index for every cacheKey whose `sourceKey` matches the
parameter, drops the matching bytes from the storage adapter, and
removes the index rows — O(log N) targeted invalidation, sibling
sources stay cached. When no index is bound (project skipped the
migration), the controller falls back to the legacy "drop every
`assets/*` entry" sweep so behaviour is preserved across the
boundary. RBAC: `delete` on `Asset`. IPX itself uses `Cache-Control`

- ETag revalidation; the asset cache sits one layer below.

## Pure planners

- `resolveStoragePath({ tenantId, folderId, fileId, filename })` —
  deterministic key layout. Tested without an adapter.
- `sanitiseFilename(input)` — drops path traversal, replaces unsafe
  characters with dashes, keeps unicode letters/digits.
- `computeCacheKey(originalKey, options)` (in `asset.service.ts`) —
  stable hash that only depends on what affects the rendered bytes.

## Tests

- `tests/stories/storage-path.story.test.ts` — pure planner.
- `tests/stories/file-storage-prisma.story.test.ts` — metadata tier.
- `tests/stories/postgres-file-blob-operations.story.test.ts` —
  `prisma.fileBlob.*` binding.
- `tests/stories/storage-factory.story.test.ts` — driver selection +
  optional-dep loading of the AWS SDK.
- `tests/stories/storage-adapter-data-store.story.test.ts` — TUS
  DataStore wrapper.
- `tests/stories/ipx-transformer.story.test.ts` — IPX-routed inline
  transform smoke test (PNG / WebP / AVIF / JPEG-quality).
- `tests/stories/ipx-source.story.test.ts` — StorageAdapter ↔ IPXStorage
  bridge.
- `tests/stories/ipx-url-planner.story.test.ts` — legacy query →
  IPX modifier translation, preset resolver, modifier-string builder,
  preset-URL rewriter.
- `tests/asset-ipx.e2e-spec.ts` — `/_ipx/*` endpoint, preset path,
  404, legacy URL backward-compat, cache-invalidation.
- `tests/files-persistence.e2e-spec.ts` — closing-the-loop e2e:
  upload, get-by-id, asset stream + cache HIT/MISS, restart-survives.

## When to drop down to the StorageAdapter directly

- Backups / lifecycle management — `list("<prefix>")` + `delete()`.
- Cross-tenant integrity scans — bypass `FileService` to read raw
  rows with explicit tenant filters.

Day-to-day work goes through `FileService` / `AssetService` — those
own the metadata + cache contracts.
