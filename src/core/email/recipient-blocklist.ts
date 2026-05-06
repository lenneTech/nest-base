/**
 * Email recipient blocklist planner (CF.EMAIL.10).
 *
 * Returns whether a given recipient address is on the blocklist —
 * and if so, why. The runner (EmailService) consults this planner
 * before invoking the SMTP/Brevo transport so blocked sends never
 * reach the wire.
 *
 * Match rules:
 *   1. Exact match (case-insensitive) on the full address.
 *   2. Domain wildcard: an entry beginning with `@` matches any
 *      address with that domain (e.g. `@example.com`).
 *   3. Sub-address neutralisation: `user+tag@example.com` matches
 *      a blocklist entry for `user@example.com` (the `+tag` part
 *      is stripped before comparison).
 *   4. Malformed addresses (no `@`) are blocked with reason
 *      `malformed-address` — the planner refuses to evaluate
 *      something that can't be a recipient.
 */

export interface BlocklistEntry {
  /**
   * Match pattern. Either a full address (`alice@example.com`),
   * or a domain wildcard starting with `@` (`@example.com`).
   * Case-insensitive.
   */
  readonly pattern: string;
  /** Human-readable reason (logged + surfaced via observability). */
  readonly reason: string;
}

export interface BlocklistInput {
  readonly address: string;
  readonly blocklist: readonly BlocklistEntry[];
}

export type BlocklistResult =
  | { readonly blocked: false }
  | { readonly blocked: true; readonly reason: string };

/**
 * Strip a sub-address tag from an email's local part:
 * `user+tag@example.com` → `user@example.com`.
 */
function canonicalAddress(address: string): string {
  const lower = address.toLowerCase().trim();
  const at = lower.indexOf("@");
  if (at === -1) return lower;
  const local = lower.slice(0, at);
  const domain = lower.slice(at);
  const plus = local.indexOf("+");
  if (plus === -1) return `${local}${domain}`;
  return `${local.slice(0, plus)}${domain}`;
}

/**
 * Resolve a recipient against the blocklist. Returns the first
 * matching entry's reason if blocked, or `{ blocked: false }`.
 */
export function checkRecipientBlocklist(input: BlocklistInput): BlocklistResult {
  const address = input.address.toLowerCase().trim();

  if (!address.includes("@")) {
    return { blocked: true, reason: "malformed-address" };
  }

  const canonical = canonicalAddress(address);
  const domain = address.slice(address.indexOf("@"));

  for (const entry of input.blocklist) {
    const pattern = entry.pattern.toLowerCase().trim();

    if (pattern.startsWith("@")) {
      // Domain wildcard.
      if (domain === pattern) {
        return { blocked: true, reason: entry.reason };
      }
      continue;
    }

    // Exact match (canonicalised on both sides).
    const patternCanonical = canonicalAddress(pattern);
    if (canonical === patternCanonical) {
      return { blocked: true, reason: entry.reason };
    }
  }

  return { blocked: false };
}
