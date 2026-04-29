import type { Features } from "../features/features.js";

/**
 * Tenant-header parsing.
 *
 * Header name comes from `features.multiTenancy.headerName`. Header
 * value MUST be a UUID — anything else is a `TenantIsolationError` so
 * RLS never sees garbage strings flowing through `SET app.tenant_id`.
 *
 * The returned value is normalised to lowercase. Postgres' `uuid` type
 * folds case internally, but any code that string-compares the raw
 * header (session caches, audit emitters, request-context echoes)
 * would mismatch on mixed-case input. Lowercasing at the parse
 * boundary gives every consumer a single canonical form.
 */

export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantIsolationError";
  }
}

export function resolveTenantHeaderName(features: Pick<Features, "multiTenancy">): string {
  return features.multiTenancy.headerName;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseTenantHeader(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    throw new TenantIsolationError("tenant header is required");
  }
  if (!UUID_RE.test(raw)) {
    // Don't echo `raw` — an attacker can stuff CRLF + a forged log
    // entry into the header. Generic message; the real value lands
    // server-side via the request-context logger.
    throw new TenantIsolationError("tenant header must be a UUID");
  }
  return raw.toLowerCase();
}
