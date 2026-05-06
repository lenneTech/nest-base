/**
 * Minimal TUS (https://tus.io) protocol client. Implements the
 * subset the File-Manager page needs:
 *
 *   - POST   <mountPath>           creates the upload, returns 201
 *                                  with Location header.
 *   - PATCH  <Location>            sends the bytes in one go with
 *                                  Upload-Offset: 0.
 *
 * The server-side `@tus/server` Server is mounted on
 * `/api/files/upload` by default — clients can resume / chunk via
 * the standard PATCH-with-offset, but for a < 50 MB single-pass
 * upload a single PATCH is the simplest path. Progress tracking
 * uses XMLHttpRequest's `upload.onprogress` (fetch() doesn't expose
 * upload progress in browsers).
 *
 * `metadata` is encoded per RFC: `key base64(value),key base64(value)`.
 */

export interface TusUploadOptions {
  endpoint: string;
  file: File;
  metadata?: Record<string, string>;
  headers?: Record<string, string>;
  onProgress?: (sentBytes: number, totalBytes: number) => void;
}

export interface TusUploadResult {
  /** Final upload URL the server returned (Location header). */
  uploadUrl: string;
}

function utf8Btoa(input: string): string {
  // btoa() runs on Latin-1; route through TextEncoder so non-ASCII
  // filenames round-trip to a valid base64 sequence per the TUS spec.
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function encodeMetadata(metadata: Record<string, string>): string {
  return Object.entries(metadata)
    .map(([k, v]) => `${k} ${utf8Btoa(v)}`)
    .join(",");
}

async function postCreate(opts: TusUploadOptions): Promise<string> {
  const headers: Record<string, string> = {
    "Tus-Resumable": "1.0.0",
    "Upload-Length": String(opts.file.size),
    ...opts.headers,
  };
  const meta = {
    filename: opts.file.name,
    filetype: opts.file.type || "application/octet-stream",
    ...opts.metadata,
  };
  headers["Upload-Metadata"] = encodeMetadata(meta);
  const res = await fetch(opts.endpoint, { method: "POST", headers });
  if (res.status !== 201) {
    const body = await res.text().catch(() => "");
    throw new Error(`TUS create failed (${res.status}): ${body}`);
  }
  const location = res.headers.get("Location");
  if (!location) throw new Error("TUS create missing Location header");
  // Location may be relative (per spec). Resolve against the
  // endpoint URL so the subsequent PATCH targets the correct origin.
  return new URL(location, new URL(opts.endpoint, window.location.origin)).toString();
}

function patchBytes(uploadUrl: string, opts: TusUploadOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PATCH", uploadUrl);
    xhr.setRequestHeader("Tus-Resumable", "1.0.0");
    xhr.setRequestHeader("Upload-Offset", "0");
    xhr.setRequestHeader("Content-Type", "application/offset+octet-stream");
    if (opts.headers) {
      for (const [k, v] of Object.entries(opts.headers)) {
        xhr.setRequestHeader(k, v);
      }
    }
    xhr.upload.onprogress = (ev: { loaded: number }) => {
      if (opts.onProgress) opts.onProgress(ev.loaded, opts.file.size);
    };
    xhr.onload = () => {
      // 204 No Content per spec; some impls return 200.
      if (xhr.status === 204 || xhr.status === 200) {
        resolve();
      } else {
        reject(new Error(`TUS patch failed (${xhr.status}): ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => reject(new Error("TUS patch network error"));
    xhr.send(opts.file);
  });
}

/**
 * Upload a single file via TUS. Two-step (create + patch) — simpler
 * than chunking and works for every file size up to the server's
 * `TUS_MAX_UPLOAD_BYTES` cap.
 */
export async function tusUpload(opts: TusUploadOptions): Promise<TusUploadResult> {
  const uploadUrl = await postCreate(opts);
  await patchBytes(uploadUrl, opts);
  return { uploadUrl };
}
