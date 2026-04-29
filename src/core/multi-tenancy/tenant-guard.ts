/**
 * Path-classification for the tenant-guard.
 *
 * Public/system paths (/, /health/*, /api/auth/*) are exempt from the
 * tenant-header requirement. Everything else needs the header to be
 * present and parseable as a UUID.
 *
 * The actual NestJS Guard wraps this classifier in a future slice.
 */

const EXEMPT_EXACT = new Set(['/', '/errors']);
const EXEMPT_PREFIXES = ['/health/', '/api/auth/', '/docs/', '/dev/', '/admin/', '/errors/'];

export function isTenantExempt(path: string): boolean {
  if (!path) throw new Error('isTenantExempt: path is required');
  if (EXEMPT_EXACT.has(path)) return true;
  for (const prefix of EXEMPT_PREFIXES) {
    if (path.startsWith(prefix) || path === prefix.slice(0, -1)) return true;
  }
  return false;
}

export function requiresTenant(path: string): boolean {
  return !isTenantExempt(path);
}
