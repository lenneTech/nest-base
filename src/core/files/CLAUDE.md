# CLAUDE.md — `src/core/files/`

This folder is the **file storage subsystem** — metadata tier, object
storage adapters, asset transforms, and TUS resumable uploads. Three
layers, all swap-out-able:

```
                  HTTP
                    │
   ┌────────────────┼────────────────────────┐
   │                │                        │
   FileController   AssetController          /api/files/upload
   POST /files/upload     GET /assets/:key   (TUS @PATCH/HEAD/POST/DELETE)
   GET  /files/:id        Sharp transformer
   DELETE …               + cache adapter
   │                                         │
   FileService      AssetService             TUS Server (lazy)
   FolderService    │  │  │                  │
   │   │            │  │  └─→ Cache adapter ─┤
   │   │            │  └─→ Origin adapter ───┤
   │   │            └─→ Sharp transformer    │
   │   │                                     │
   PrismaFileStorage  ←———————————————————→  StorageAdapterDataStore
   PrismaFolderStorage                        │
   │                                          │
   PrismaService                              StorageAdapter (origin)
   prisma.file / .folder                      LocalStorageAdapter |
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

`AssetController.GET /assets/:key`:

1. probe the cache adapter for `computeCacheKey(key, options)`,
2. emit `x-cache: HIT|MISS|BYPASS` (`BYPASS` when no transform was
   requested),
3. delegate to `AssetService.deliver(key, options)`,
4. AssetService either reads cached bytes or runs the original
   through `SharpTransformer` and stores the result in the cache,
5. controller streams the bytes back with `content-type` set from
   the adapter and `cache-control: public, max-age=86400` for the
   browser.

Issue #17 swaps `SharpTransformer` for IPX. The `AssetTransformer`
interface stays.

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
- `tests/stories/sharp-transformer.story.test.ts` — `sharp` smoke
  test.
- `tests/files-persistence.e2e-spec.ts` — closing-the-loop e2e:
  upload, get-by-id, asset stream + cache HIT/MISS, restart-survives.

## When to drop down to the StorageAdapter directly

- Backups / lifecycle management — `list("<prefix>")` + `delete()`.
- Cross-tenant integrity scans — bypass `FileService` to read raw
  rows with explicit tenant filters.

Day-to-day work goes through `FileService` / `AssetService` — those
own the metadata + cache contracts.
