/**
 * TUS upload — mime-type allowlist enforcement (PLAN.md §8).
 *
 * Allowlist semantics:
 *   []                  → no restriction (opt-in policy)
 *   ['image/png']       → exact match
 *   ['image/*']         → group wildcard
 *   ['*\/*']             → match anything
 *
 * Comparison is case-insensitive; both inputs are normalized.
 * Malformed mime types (no slash) are rejected.
 */

const MIME_RE = /^([a-z0-9!#$%&'*+\-.^_`|~]+)\/([a-z0-9!#$%&'*+\-.^_`|~]+)$/i;

export class FileTypeRejectedError extends Error {
  constructor(public readonly mimeType: string) {
    super(`upload rejected: mime type "${mimeType}" is not in the allowlist`);
    this.name = 'FileTypeRejectedError';
  }
}

export function isMimeTypeAllowed(mimeType: string, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return true;
  if (!mimeType) return false;

  const inputMatch = MIME_RE.exec(mimeType.toLowerCase());
  if (!inputMatch) return false;
  const [, type, subtype] = inputMatch;

  for (const entry of allowlist) {
    const allowMatch = MIME_RE.exec(entry.toLowerCase());
    if (!allowMatch) continue;
    const [, allowType, allowSub] = allowMatch;
    const typeOk = allowType === '*' || allowType === type;
    const subOk = allowSub === '*' || allowSub === subtype;
    if (typeOk && subOk) return true;
  }
  return false;
}

export function validateUploadFileType(mimeType: string, allowlist: readonly string[]): string {
  if (!isMimeTypeAllowed(mimeType, allowlist)) {
    throw new FileTypeRejectedError(mimeType);
  }
  return mimeType;
}
