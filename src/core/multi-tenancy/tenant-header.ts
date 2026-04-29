import type { Features } from "../features/features.js";

/**
 * Tenant-header parsing.
 *
 * Header name comes from `features.multiTenancy.headerName`. Header
 * value MUST be a UUID — anything else is a `TenantIsolationError` so
 * RLS never sees garbage strings flowing through `SET app.tenant_id`.
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
    throw new TenantIsolationError(`tenant header must be a UUID (received: ${raw})`);
  }
  return raw;
}
