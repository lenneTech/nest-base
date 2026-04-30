/**
 * Cursor pagination.
 *
 * Stable append-only pagination as an alternative to page/limit.
 * The cursor is opaque to the client — base64url of a minimal
 * `{sortValue, id}` JSON payload — so the controller can change its
 * sort key without breaking already-issued cursors.
 *
 * Page-shape contract: the controller fetches `limit + 1` rows,
 * passes the slice through `buildCursorPage(rows, limit)`, and
 * returns the resulting `{ items, nextCursor }`. `items` is capped
 * at `limit`; `nextCursor` is only present when a next page
 * actually exists (input length > limit).
 */

export type CursorSortValue = string | number;

export interface CursorRecord {
  id: string;
  sortValue: CursorSortValue;
}

export interface CursorPage<T extends CursorRecord> {
  items: T[];
  nextCursor?: string;
}

export class CursorMalformedError extends Error {
  constructor(reason: string) {
    super(`cursor: malformed (${reason})`);
    this.name = "CursorMalformedError";
  }
}

export function encodeCursor(record: CursorRecord): string {
  const payload = JSON.stringify({ s: record.sortValue, i: record.id });
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): CursorRecord {
  if (!cursor) throw new CursorMalformedError("empty");
  let parsed: unknown;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    parsed = JSON.parse(decoded);
  } catch (err) {
    throw new CursorMalformedError(err instanceof Error ? err.message : "parse failed");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new CursorMalformedError("payload is not an object");
  }
  const { s, i } = parsed as { s?: unknown; i?: unknown };
  if ((typeof s !== "string" && typeof s !== "number") || typeof i !== "string") {
    throw new CursorMalformedError("missing sortValue or id");
  }
  return { sortValue: s, id: i };
}

export function buildCursorPage<T extends CursorRecord>(rows: T[], limit: number): CursorPage<T> {
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error(`cursor: limit must be a positive integer (got ${limit})`);
  }
  if (rows.length === 0) {
    return { items: [] };
  }
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  if (!hasMore) {
    return { items };
  }
  const last = items[items.length - 1]!;
  return {
    items,
    nextCursor: encodeCursor({ sortValue: last.sortValue, id: last.id }),
  };
}
