/**
 * File-Manager sort + filter planner.
 *
 * Pure function used by both the React file-grid (client-side, ≤ 500
 * files) and the server's list endpoint (above 500 files, server-side).
 * Stable, deterministic, no I/O.
 *
 * Story coverage: `tests/stories/file-manager-search.story.test.ts`.
 */

export interface FileSearchInput {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export type FileSearchSortKey = "name" | "size" | "createdAt" | "updatedAt" | "mimeType";
export type FileSearchSortDirection = "asc" | "desc";

export interface FileSearchOptions {
  /** Free-text substring match against `filename` (case-insensitive). */
  search?: string;
  /** MIME-type prefix match (e.g. `image/`). Case-insensitive. */
  mimeTypePrefix?: string;
  sortBy?: FileSearchSortKey;
  sortDirection?: FileSearchSortDirection;
  /** Cap on the returned slice. Applied after sort. */
  limit?: number;
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

const SORT_KEYS: ReadonlySet<FileSearchSortKey> = new Set([
  "name",
  "size",
  "createdAt",
  "updatedAt",
  "mimeType",
]);

/**
 * Apply the supplied filter + sort + limit options to a flat file
 * array. Returns a new array; the input is not mutated.
 */
export function applyFileSearch<T extends FileSearchInput>(
  input: readonly T[],
  opts: FileSearchOptions,
): T[] {
  const search = opts.search?.trim().toLowerCase() ?? "";
  const mimePrefix = opts.mimeTypePrefix?.trim().toLowerCase() ?? "";
  const filtered = input.filter((f) => {
    if (search && !f.filename.toLowerCase().includes(search)) return false;
    if (mimePrefix && !f.mimeType.toLowerCase().startsWith(mimePrefix)) return false;
    return true;
  });

  const sortKey: FileSearchSortKey = SORT_KEYS.has(opts.sortBy as FileSearchSortKey)
    ? (opts.sortBy as FileSearchSortKey)
    : "name";
  const direction: FileSearchSortDirection = opts.sortDirection === "desc" ? "desc" : "asc";
  const sorted = [...filtered].sort((a, b) => compare(a, b, sortKey));
  if (direction === "desc") sorted.reverse();

  if (opts.limit !== undefined && opts.limit >= 0 && sorted.length > opts.limit) {
    return sorted.slice(0, opts.limit);
  }
  return sorted;
}

function compare(a: FileSearchInput, b: FileSearchInput, key: FileSearchSortKey): number {
  switch (key) {
    case "size":
      return a.sizeBytes - b.sizeBytes;
    case "createdAt":
      return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    case "updatedAt":
      return Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
    case "mimeType":
      return collator.compare(a.mimeType, b.mimeType);
    case "name":
    default:
      return collator.compare(a.filename, b.filename);
  }
}
