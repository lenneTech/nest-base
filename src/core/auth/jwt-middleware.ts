/**
 * JWT-middleware path classification.
 *
 * Allowlist-driven: by default every API path requires a valid session
 * or scoped API key. The `PUBLIC_PREFIXES` set is the only escape hatch
 * — it covers diagnostics, the Better-Auth handler, and the docs UI.
 */

const PUBLIC_PREFIXES = ['/health/', '/api/auth/', '/docs/', '/dev/'];
const PUBLIC_EXACT = new Set(['/']);

export function isPathProtected(path: string): boolean {
  if (!path) throw new Error('isPathProtected: path is required');
  if (PUBLIC_EXACT.has(path)) return false;
  for (const prefix of PUBLIC_PREFIXES) {
    if (path.startsWith(prefix) || path === prefix.slice(0, -1)) return false;
  }
  return true;
}
