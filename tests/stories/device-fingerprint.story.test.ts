import { describe, expect, it } from "vitest";

import {
  fingerprintSession,
  maskIp,
  type FingerprintMode,
} from "../../src/core/devices/fingerprint.js";

/**
 * Story · Device fingerprint planner.
 *
 * Issue #13 acceptance: a sha256 fingerprint derived from the
 * `userAgent` + (optionally) the IP-network-prefix. The IP-prefix
 * trick is the privacy-vs-mobility compromise: full IPs would mark
 * every cellular connection as a "new device", while pure UA hashes
 * collide too eagerly across users on the same browser. /24 (IPv4)
 * and /64 (IPv6) line up with how ISPs allocate subnets, so a
 * mobile user roaming inside the same provider keeps the same
 * fingerprint.
 *
 * The planner is pure — no I/O, no env, no Date. The runner that
 * persists the fingerprint + checks "is this new?" lives in
 * `device-handling.ts` and gets its own story file.
 */
describe("Story · device fingerprint planner", () => {
  describe("maskIp()", () => {
    it("masks an IPv4 address to its /24 network prefix", () => {
      // /24 keeps the first three octets, zeroes the fourth — the
      // /24 prefix is the granularity at which residential ISPs and
      // most mobile carriers hand out addresses.
      expect(maskIp("192.168.1.42", "userAgent+ipSubnet")).toBe("192.168.1.0/24");
    });

    it("normalises an IPv6 address to its /64 network prefix", () => {
      // /64 is the IPv6 host-routing boundary. Anything below /64
      // is the host's interface identifier and changes per-device
      // / per-temporary-address (RFC 4941). Masking keeps the
      // routable subnet stable.
      expect(maskIp("2001:db8:1234:5678:abcd:ef01:2345:6789", "userAgent+ipSubnet")).toBe(
        "2001:db8:1234:5678::/64",
      );
    });

    it("normalises an abbreviated IPv6 address (`::1` etc.)", () => {
      expect(maskIp("::1", "userAgent+ipSubnet")).toBe("0:0:0:0::/64");
    });

    it("leaves the IP empty in `userAgent`-only mode", () => {
      // Pure UA-mode disables the IP component entirely; the planner
      // returns an empty marker so the caller's hash input is stable
      // and doesn't accidentally include a stray IP fragment.
      expect(maskIp("10.0.0.1", "userAgent")).toBe("");
    });

    it("returns a marker for malformed IP strings", () => {
      // Defensive: a malformed IP (truncated header, manually
      // crafted) should NOT crash the auth flow. The marker keeps
      // the hash deterministic for the same malformed input.
      expect(maskIp("not-an-ip", "userAgent+ipSubnet")).toBe("invalid");
      expect(maskIp("", "userAgent+ipSubnet")).toBe("invalid");
    });
  });

  describe("fingerprintSession()", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
    const ipA = "192.168.1.42";
    const ipB = "192.168.1.99"; // same /24 as ipA
    const ipC = "10.0.0.5"; // different /24

    it("produces a stable sha256 hex hash (64 chars)", () => {
      const hash = fingerprintSession({ userAgent: ua, ip: ipA, mode: "userAgent+ipSubnet" });
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("returns identical hashes for two IPs in the same /24", () => {
      const a = fingerprintSession({ userAgent: ua, ip: ipA, mode: "userAgent+ipSubnet" });
      const b = fingerprintSession({ userAgent: ua, ip: ipB, mode: "userAgent+ipSubnet" });
      expect(a).toBe(b);
    });

    it("returns different hashes for IPs in different /24 subnets", () => {
      const a = fingerprintSession({ userAgent: ua, ip: ipA, mode: "userAgent+ipSubnet" });
      const c = fingerprintSession({ userAgent: ua, ip: ipC, mode: "userAgent+ipSubnet" });
      expect(a).not.toBe(c);
    });

    it("collapses different IPs to the same hash in `userAgent`-only mode", () => {
      const a = fingerprintSession({ userAgent: ua, ip: ipA, mode: "userAgent" });
      const c = fingerprintSession({ userAgent: ua, ip: ipC, mode: "userAgent" });
      expect(a).toBe(c);
    });

    it("returns different hashes for different user-agents", () => {
      const chrome = fingerprintSession({ userAgent: ua, ip: ipA, mode: "userAgent+ipSubnet" });
      const safari = fingerprintSession({
        userAgent: "Mozilla/5.0 Safari/605.1.15",
        ip: ipA,
        mode: "userAgent+ipSubnet",
      });
      expect(chrome).not.toBe(safari);
    });

    it("treats missing IP as empty (still derives a stable hash from UA)", () => {
      const a = fingerprintSession({
        userAgent: ua,
        ip: undefined,
        mode: "userAgent+ipSubnet",
      });
      const b = fingerprintSession({ userAgent: ua, ip: "", mode: "userAgent+ipSubnet" });
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it("treats missing UA as empty (still derives a stable hash)", () => {
      // Better-Auth lets ipAddress + userAgent both be nullish — the
      // planner must not crash if a sign-in request lacks the UA
      // header (e.g. a curl probe in tests).
      const hash = fingerprintSession({
        userAgent: undefined,
        ip: ipA,
        mode: "userAgent+ipSubnet",
      });
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("varies the hash by mode (UA+subnet vs UA-only)", () => {
      const subnet = fingerprintSession({ userAgent: ua, ip: ipA, mode: "userAgent+ipSubnet" });
      const uaOnly = fingerprintSession({ userAgent: ua, ip: ipA, mode: "userAgent" });
      // Same inputs, different mode → different hash. Otherwise a
      // mode flip on a live deployment would invisibly mark every
      // session as "known", defeating the whole point of the toggle.
      expect(subnet).not.toBe(uaOnly);
    });
  });

  it("exposes the FingerprintMode union mirroring the schema enum", () => {
    const modes: FingerprintMode[] = ["userAgent+ipSubnet", "userAgent"];
    expect(modes).toHaveLength(2);
  });
});
