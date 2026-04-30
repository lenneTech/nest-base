import { createHash } from "node:crypto";

/**
 * ETag / If-Match optimistic-concurrency primitives
 *.
 *
 * Strong-comparison only — `W/` weak tags are explicitly rejected so
 * a proxy that downgrades a strong tag to a weak one can't bypass
 * the precondition.
 *
 * The pipe stays pure: the controller loads the record, calls
 * verifyIfMatch(currentETag, request.header), and on
 * ETagPreconditionFailedError responds with `412 Precondition
 * Failed` + the current ETag (the error carries it for that
 * purpose). On ETagMissingError the controller responds with
 * `428 Precondition Required`.
 */

export interface ETagSourceFields {
  version: number;
  updatedAt: string;
}

export class ETagMissingError extends Error {
  constructor() {
    super("etag: If-Match header is required for this mutation");
    this.name = "ETagMissingError";
  }
}

export class ETagPreconditionFailedError extends Error {
  constructor(public readonly currentETag: string) {
    super(`etag: If-Match did not match current ETag ${currentETag}`);
    this.name = "ETagPreconditionFailedError";
  }
}

export function computeETag(source: ETagSourceFields): string {
  const fingerprint = `${source.version}|${source.updatedAt}`;
  const hash = createHash("sha256").update(fingerprint).digest("hex").slice(0, 16);
  return `"v${source.version}-${hash}"`;
}

export function parseIfMatch(header: string | undefined | null): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function verifyIfMatch(currentETag: string, header: string | undefined | null): void {
  if (header === undefined || header === null || header.trim().length === 0) {
    throw new ETagMissingError();
  }
  const candidates = parseIfMatch(header);
  for (const candidate of candidates) {
    if (candidate === "*") return;
    if (candidate.startsWith("W/")) continue; // strong-comparison: weak tags never match
    if (candidate === currentETag) return;
  }
  throw new ETagPreconditionFailedError(currentETag);
}
