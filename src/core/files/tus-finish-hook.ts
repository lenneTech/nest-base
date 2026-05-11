import { createHash } from "node:crypto";

import { resolveStoragePath } from "./storage-path.js";
import type { StorageAdapterDataStore } from "./storage-adapter-data-store.js";
import type { FileService } from "./file.service.js";
import { uuidV7 } from "../uuid/uuid-v7.js";

/**
 * Minimal shape of a completed TUS Upload that the finish hook needs.
 * Mirrors the `Upload` class from `@tus/utils` — declared locally so
 * the hook stays importable without pulling in the full `@tus/server`
 * package at test time.
 */
export interface TusFinishHookUpload {
  id: string;
  size?: number | null;
  offset?: number;
  metadata?: Record<string, string | null> | null;
}

export interface TusFinishHookResult {
  headers?: Record<string, string | number>;
}

export interface BuildTusFinishHookOptions {
  fileService: FileService;
  dataStore: StorageAdapterDataStore;
}

/**
 * Factory for the `onUploadFinish` callback wired into `@tus/server`.
 *
 * When all bytes are received the hook:
 *   1. Reads the assembled bytes from the `_tus/<id>` staging area.
 *   2. Promotes them into the FileService (creates a FileRecord with
 *      a deterministic storage key under `<tenantId>/<folderId>/<id>-<filename>`).
 *   3. Cleans up the `_tus/<id>` staging entry.
 *   4. Returns `Upload-File-Id` and `Upload-Storage-Key` headers so
 *      callers don't need a follow-up request (issue #102).
 *
 * The hook expects these keys in the TUS `Upload-Metadata` field
 * (all optional — defaults below):
 *   - `filename`   → stored filename  (default: upload id)
 *   - `filetype`   → MIME type        (default: application/octet-stream)
 *   - `tenantId`   → tenant context   (required; empty string if absent)
 *   - `uploaderId` → uploader user id (required; empty string if absent)
 *   - `folderId`   → parent folder id (nullable; null when absent)
 *
 * Signature matches `@tus/server` v2 `ServerOptions.onUploadFinish`:
 *   `(req, upload) => Promise<{ headers?, status_code?, body? }>`
 * The `req` parameter is unused here (we only need upload metadata)
 * but must be present to satisfy the framework contract.
 */
export function buildTusFinishHook(
  opts: BuildTusFinishHookOptions,
): (_req: unknown, upload: TusFinishHookUpload) => Promise<TusFinishHookResult> {
  const { fileService, dataStore } = opts;

  return async function onUploadFinish(
    _req: unknown,
    upload: TusFinishHookUpload,
  ): Promise<TusFinishHookResult> {
    const meta = upload.metadata ?? {};
    const filename = meta["filename"] ?? upload.id;
    const mimeType = meta["filetype"] ?? "application/octet-stream";
    const tenantId = meta["tenantId"] ?? "";
    const uploaderId = meta["uploaderId"] ?? "";
    // `null` string or absent → treat as root folder
    const rawFolderId = meta["folderId"];
    const folderId = rawFolderId === null || rawFolderId === undefined ? null : rawFolderId;

    // Read the assembled bytes from the TUS staging area.
    const bytes = await dataStore.readBody(upload.id);

    const fileId = uuidV7();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storageKey = resolveStoragePath({ tenantId, folderId, fileId, filename });

    // Persist the bytes at the final key.
    const adapter = fileService.storageAdapter;
    if (!adapter) {
      throw new Error("tus-finish-hook: FileService has no storageAdapter binding");
    }
    await adapter.put({ key: storageKey, body: bytes, mimeType });

    // Register the FileRecord in the metadata store.
    const storageDriver = detectDriverName(adapter);
    const record = {
      id: fileId,
      tenantId,
      folderId,
      filename,
      mimeType,
      sizeBytes: bytes.byteLength,
      sha256,
      storageDriver,
      storageKey,
      uploaderId,
      visibility: "PRIVATE" as const,
    };
    // Insert directly via insertRecord() to avoid the scanVerdict /
    // uploadAndCreate logic which would re-put the bytes. The bytes are
    // already at the final key (written above). insertRecord() is the
    // public API that replaces the previous Reflect.get(fileService, "storage")
    // call so that a rename of the private field cannot break this silently.
    await fileService.insertRecord(record);

    // Clean up the TUS staging area now that bytes are at the final key.
    await dataStore.remove(upload.id);

    return {
      headers: {
        "Upload-File-Id": fileId,
        "Upload-Storage-Key": storageKey,
      },
    };
  };
}

function detectDriverName(adapter: object): string {
  const name = (adapter as { constructor: { name: string } }).constructor.name;
  if (name === "S3StorageAdapter") return "s3";
  if (name === "LocalStorageAdapter") return "local";
  if (name === "PostgresStorageAdapter") return "postgres";
  return "memory";
}
