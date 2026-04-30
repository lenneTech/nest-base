import { createHash } from "node:crypto";

/**
 * Device fingerprint planner.
 *
 * Issue #13 turns "userAgent + ipAddress" into a stable, hashed
 * device-identity that the new-device detector can compare against
 * past sessions. Two design choices:
 *
 * 1. **Subnet, not full IP.** A residential ISP rotates the IPv4 host
 *    octet on every modem reboot; a mobile carrier rotates it on every
 *    cellular hop. Hashing the full address would mark every
 *    "bus-ride wifi → home wifi" hop as a new device. /24 (IPv4) and
 *    /64 (IPv6) line up with how carriers allocate subnets, so a roaming
 *    user inside the same provider keeps the same fingerprint.
 *
 * 2. **No raw IP storage.** The planner returns only the hash — the
 *    raw masked CIDR is an internal intermediate. Persistence layers
 *    store the hash; logs strip the IP. The trade-off: investigators
 *    can no longer reverse-engineer "what IP signed in" from the DB,
 *    but a leak of the device table doesn't expose user IPs either.
 *
 * The planner is pure: no I/O, no env, no Date. The runner that
 * persists the fingerprint + decides "new vs. known" lives in
 * `device-handling.ts`.
 */

export type FingerprintMode = "userAgent+ipSubnet" | "userAgent";

export interface FingerprintInput {
  /** Better-Auth's `userAgent` is nullish — both undefined and "" map to "no UA". */
  userAgent: string | undefined | null;
  /** Better-Auth's `ipAddress` is nullish — both undefined and "" map to "no IP". */
  ip: string | undefined | null;
  mode: FingerprintMode;
}

/**
 * IPv4 default mask: drop the last octet (host part of a /24
 * residential subnet).
 */
const IPV4_PREFIX_OCTETS = 3;
/**
 * IPv6 default mask: keep the first 64 bits (the routable prefix).
 * Lower 64 bits are the interface identifier — RFC 4941 rotates
 * those for privacy, so masking them is required for stability.
 */
const IPV6_PREFIX_GROUPS = 4;

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

/**
 * Returns the masked network prefix string used as input to the
 * fingerprint hash. Exposed for tests + diagnostic logs; callers
 * should not store the return value (only the hash itself is safe).
 *
 * Returns "" in `userAgent`-only mode (the IP component is dropped
 * from the hash entirely) and "invalid" for malformed inputs (so
 * the hash stays deterministic without crashing the auth flow).
 */
export function maskIp(ip: string | undefined | null, mode: FingerprintMode): string {
  if (mode === "userAgent") return "";
  const trimmed = (ip ?? "").trim();
  if (!trimmed) return "invalid";

  if (IPV4_RE.test(trimmed)) {
    const octets = trimmed.split(".").map((segment) => Number(segment));
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return "invalid";
    const head = octets.slice(0, IPV4_PREFIX_OCTETS).join(".");
    return `${head}.0/24`;
  }

  // IPv6: expand any "::" abbreviation, then keep the first 4 groups.
  const expanded = expandIpv6(trimmed);
  if (!expanded) return "invalid";
  const head = expanded.slice(0, IPV6_PREFIX_GROUPS).join(":");
  return `${head}::/64`;
}

/**
 * Computes the sha256 hex hash of `(mode, ua, masked-ip)`. The mode
 * is part of the input so flipping the toggle between deployments
 * produces a fresh fingerprint set instead of silently re-classifying
 * every old session as "known" (or vice versa).
 */
export function fingerprintSession(input: FingerprintInput): string {
  const ua = (input.userAgent ?? "").trim();
  const masked = maskIp(input.ip, input.mode);
  // Pipe-separated so the components can never collide via clever
  // UA strings that contain a stray "/24" suffix etc.
  const composite = `${input.mode}|${ua}|${masked}`;
  return createHash("sha256").update(composite, "utf8").digest("hex");
}

/**
 * Expands an IPv6 address (possibly containing `::`) into an array
 * of 8 hex group strings (each lowercased, leading zeros stripped).
 * Returns `null` for unparseable inputs.
 */
function expandIpv6(ip: string): string[] | null {
  const lower = ip.toLowerCase();
  // Reject anything that's clearly not IPv6 — ua-parser-js doesn't
  // run here, so the regex is the gate.
  if (!/^[0-9a-f:]+$/i.test(lower)) return null;
  const parts = lower.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts[1] ? parts[1].split(":") : [];
  const filled = parts.length === 2 ? 8 - head.length - tail.length : 8 - head.length;
  if (filled < 0) return null;
  const middle = parts.length === 2 ? Array.from<string>({ length: filled }).fill("0") : [];
  const groups = [...head, ...middle, ...tail];
  if (groups.length !== 8) return null;
  // Strip leading zeros so equivalent forms hash the same.
  return groups.map((g) => g.replace(/^0+(?=.)/, ""));
}
