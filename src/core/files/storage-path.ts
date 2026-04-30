/**
 * Storage path planner.
 *
 * Pure function. The StorageAdapter contract is key→bytes; this module
 * is the deterministic key derivation step that lives between
 * `FileService.create()` and the chosen adapter. Keeping the layout
 * contract in one place lets tests pin it without booting an adapter.
 *
 * Layout:  `<tenantId>/<folderId|_root>/<fileId>-<sanitised-filename>`
 *
 * Why include the fileId: two users uploading `photo.jpg` to the same
 * folder must not collide; the upload-time UUID guarantees uniqueness
 * without forcing the user-visible filename to mutate.
 */

export interface ResolveStoragePathInput {
  tenantId: string;
  folderId: string | null;
  fileId: string;
  filename: string;
}

const ROOT_SEGMENT = "_root";

export function resolveStoragePath(input: ResolveStoragePathInput): string {
  if (!input.tenantId) throw new Error("storage-path: tenantId is required");
  if (!input.fileId) throw new Error("storage-path: fileId is required");
  if (!input.filename) throw new Error("storage-path: filename is required");
  const folder = input.folderId ?? ROOT_SEGMENT;
  const cleanFilename = sanitiseFilename(input.filename);
  return `${input.tenantId}/${folder}/${input.fileId}-${cleanFilename}`;
}

/**
 * Reduce a user-supplied filename to a key-safe form.
 *
 * - drops path traversal (`..`) and any directory separators,
 * - replaces whitespace and characters outside the safe-set with `-`,
 * - throws when the result is empty (otherwise `///` would map to "").
 *
 * Allowed: letters (incl. unicode), digits, `.`, `-`, `_`.
 */
export function sanitiseFilename(input: string): string {
  if (!input) throw new Error("storage-path: filename is required");
  // Split on any path separator (POSIX `/` or Windows `\`) and drop
  // empty segments + traversal markers so neither shows up in the
  // resulting key. The remaining segments are joined with `-` to
  // preserve user intent on inputs like `a/b/c.png` → `a-b-c.png`.
  const segments = input
    .replaceAll("\\", "/")
    .split("/")
    .filter((seg) => seg.length > 0 && seg !== "..");
  const joined = segments.join("-");
  // Replace unsafe characters with dashes — keep unicode letters/digits.
  const safe = joined.replaceAll(/[^\p{L}\p{N}._-]/gu, "-");
  if (!safe) throw new Error("storage-path: filename is empty after sanitisation");
  return safe;
}
