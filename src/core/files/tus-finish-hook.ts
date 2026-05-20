import { createHash } from "node:crypto";

import { checkSniffedMimeMatchesClaim } from "./magic-byte-sniffer.js";
import { resolveStoragePath } from "./storage-path.js";
import type { StorageAdapterDataStore } from "./storage-adapter-data-store.js";
import type { FileService } from "./file.service.js";
import { uuidV7 } from "../uuid/uuid-v7.js";
import type { BetterAuthInstance } from "../auth/better-auth.token.js";

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

/**
 * Minimal shape of the HTTP request object passed to TUS hooks.
 * The TUS server v3 uses srvx's ServerRequest (extends Fetch API Request)
 * so the `headers` field is a Fetch API `Headers` object compatible with
 * BetterAuth's `getSession({ headers })` call.
 */
export interface TusHookRequest {
  headers: Headers;
}

export interface BuildTusFinishHookOptions {
  fileService: FileService;
  dataStore: StorageAdapterDataStore;
  /**
   * Optional BetterAuth instance used to validate that the session
   * tenantId matches the upload metadata tenantId (Fix 1.1 — tenant
   * spoofing guard). When null or undefined the check is skipped so
   * projects that haven't wired Better-Auth still get uploads; this
   * is the pre-fix backward-compat path.
   */
  auth?: BetterAuthInstance | null;
}

/**
 * Factory for the `onUploadFinish` callback wired into `@tus/server`.
 *
 * When all bytes are received the hook:
 *   1. Validates that the session tenantId matches the Upload-Metadata
 *      tenantId (Fix 1.1 — prevent tenant spoofing via metadata header).
 *   2. Reads the assembled bytes from the `_tus/<id>` staging area.
 *   3. Promotes them into the FileService (creates a FileRecord with
 *      a deterministic storage key under `<tenantId>/<folderId>/<id>-<filename>`).
 *   4. Cleans up the `_tus/<id>` staging entry.
 *   5. Returns `Upload-File-Id` and `Upload-Storage-Key` headers so
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
 *
 * Security note: the TUS server is mounted outside the NestJS middleware
 * stack (via Express `app.use()`), so `BetterAuthSessionMiddleware` and
 * `TenantInterceptor` do NOT run for TUS requests. The tenant-validation
 * check in this hook is therefore the only server-side enforcement that
 * the metadata `tenantId` matches an authenticated session.
 */
export function buildTusFinishHook(
  opts: BuildTusFinishHookOptions,
): (req: TusHookRequest, upload: TusFinishHookUpload) => Promise<TusFinishHookResult> {
  const { fileService, dataStore, auth } = opts;

  return async function onUploadFinish(
    req: TusHookRequest,
    upload: TusFinishHookUpload,
  ): Promise<TusFinishHookResult> {
    const meta = upload.metadata ?? {};
    const filename = meta["filename"] ?? upload.id;
    const mimeType = meta["filetype"] ?? "application/octet-stream";
    const metaTenantId = meta["tenantId"] ?? "";
    const uploaderId = meta["uploaderId"] ?? "";
    // `null` string or absent → treat as root folder
    const rawFolderId = meta["folderId"];
    const folderId = rawFolderId === null || rawFolderId === undefined ? null : rawFolderId;

    // Fix 1.1 — Tenant validation: ensure the metadata tenantId matches the
    // session's active organization / tenantId. The TUS server runs outside
    // the NestJS middleware stack so we must validate the session explicitly
    // here rather than relying on TenantInterceptor.
    //
    // When `auth` is null (BetterAuth not configured) we skip the check so
    // unauthenticated / development setups still function. In production the
    // auth instance is always provided.
    if (auth) {
      // CRIT-1: empty metaTenantId with auth configured is always an error —
      // a blank tenantId would previously pass the `if (auth && metaTenantId)`
      // guard and land the file root-scoped.
      if (!metaTenantId) {
        return {
          ...(tusErrorResponse(400, "tus-finish-hook: tenantId metadata is required") as object),
        };
      }

      const session = await resolveSession(auth, req.headers);
      if (!session) {
        // No valid session — reject the upload to prevent unauthenticated
        // file creation. Return a 401-equivalent via status_code so @tus/server
        // surfaces it as an HTTP error instead of continuing.
        return {
          ...(tusErrorResponse(401, "tus-finish-hook: unauthenticated upload rejected") as object),
        };
      }
      const sessionTenantId =
        (session as { session?: { activeOrganizationId?: string | null } }).session
          ?.activeOrganizationId ?? "";
      // CRIT-2: if sessionTenantId is empty the session has no active org —
      // we cannot verify the claim, so reject. Previously the falsy guard
      // `if (sessionTenantId && ...)` skipped this check entirely.
      if (!sessionTenantId || sessionTenantId !== metaTenantId) {
        // The Upload-Metadata tenantId was spoofed or the session has no
        // active organization — reject with 403.
        return {
          ...(tusErrorResponse(
            403,
            `tus-finish-hook: metadata tenantId "${metaTenantId}" does not match session tenantId "${sessionTenantId}"`,
          ) as object),
        };
      }
    }

    const tenantId = metaTenantId;

    // Read the assembled bytes from the TUS staging area.
    const bytes = await dataStore.readBody(upload.id);

    // MAJ-5: MIME sniffing — verify that the actual content matches the
    // client-supplied filetype metadata. A PE binary uploaded as "image/png"
    // must be rejected here. The sniffer returns ok=true when the format is
    // unrecognised (lenient: unknown formats are allowed through) and ok=false
    // only when the sniffed type actively contradicts the claim.
    const sniffResult = checkSniffedMimeMatchesClaim(bytes.subarray(0, 256), mimeType);
    if (!sniffResult.ok) {
      return {
        ...(tusErrorResponse(
          415,
          `tus-finish-hook: MIME mismatch — claimed "${sniffResult.claimed}", sniffed "${sniffResult.sniffed}"`,
        ) as object),
      };
    }

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

/**
 * Attempt to resolve a Better-Auth session from the request headers.
 * Returns null on any failure (missing cookie, expired session, etc.).
 * The `headers` parameter is a Fetch API `Headers` object — BetterAuth's
 * `api.getSession` accepts this shape directly.
 */
async function resolveSession(auth: BetterAuthInstance, headers: Headers): Promise<unknown> {
  try {
    return await auth.api.getSession({ headers });
  } catch {
    return null;
  }
}

/**
 * Build a TUS-compatible error response object.
 * @tus/server reads `status_code` + `body` on the returned object to
 * construct the HTTP error response when an `onUploadFinish` hook returns
 * a non-success shape.
 */
function tusErrorResponse(
  statusCode: number,
  message: string,
): { status_code: number; body: string } {
  return { status_code: statusCode, body: message };
}

function detectDriverName(adapter: object): string {
  // Prefer the stable `driverName` property over `constructor.name`
  // (H3/L2 fix): constructor.name is mangled by minifiers in production
  // builds, and was also missing "rustfs" as a distinct case. Each
  // StorageAdapter implementation now declares `readonly driverName`.
  const named = adapter as { driverName?: unknown };
  if (typeof named.driverName === "string" && named.driverName.length > 0) {
    return named.driverName;
  }
  // Fallback for adapters that haven't yet added driverName.
  return "memory";
}
