/**
 * SSRF-prevention URL validator for webhook endpoints (CRIT-3 fix).
 *
 * Webhooks perform server-side HTTP POSTs to operator-configured URLs.
 * Without a blocklist an attacker who controls a webhook endpoint
 * configuration could steer requests to internal services (metadata
 * API, Redis, Postgres, intranet hosts).
 *
 * Only `http:` and `https:` are allowed. Hostnames that resolve to
 * private/loopback/link-local ranges are rejected up-front based on
 * their literal hostname value. This is a best-effort pre-filter; a
 * full DNS-rebinding defence would require resolving the hostname and
 * checking every A/AAAA record — that is an async operation and
 * introduces its own TOCTOU window. The literal-hostname check covers
 * the vast majority of SSRF patterns in practice.
 */

export class InvalidWebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWebhookUrlError";
  }
}

/**
 * Patterns that match hostnames corresponding to private / loopback /
 * link-local / cloud-metadata address spaces. Checked against the
 * lower-cased `parsed.hostname`.
 */
const BLOCKED_HOSTNAME_PATTERNS: RegExp[] = [
  /^localhost$/,
  /^127\./,
  /^::1$|^\[::1\]$/,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  // AWS / GCP / Azure instance-metadata endpoints.
  /^metadata\./,
  // Carrier-grade NAT (RFC 6598).
  /^100\.64\./,
  // IPv6 ULA (fc00::/7) and link-local (fe80::/10).
  /^\[?fc[0-9a-f]{2}:/i,
  /^\[?fd[0-9a-f]{2}:/i,
  /^\[?fe[89ab][0-9a-f]:/i,
];

/**
 * Validate a webhook target URL.
 *
 * @throws {InvalidWebhookUrlError} when the URL is malformed, uses a
 *   non-http(s) protocol, or targets a private/loopback address range.
 */
export function validateWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidWebhookUrlError(`Invalid URL: ${url}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new InvalidWebhookUrlError(
      `Only http/https allowed for webhook URLs (got "${parsed.protocol}")`,
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAME_PATTERNS.some((re) => re.test(hostname))) {
    throw new InvalidWebhookUrlError(
      `Blocked hostname "${hostname}" — webhook URLs must not target internal/private networks`,
    );
  }
}
