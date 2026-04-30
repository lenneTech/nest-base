import { describe, expect, it } from "vitest";

import {
  buildEmailHookPayload,
  type BetterAuthEmailUser,
} from "../../src/core/auth/better-auth-email-hooks.js";

/**
 * Story · New-device email payload builder.
 *
 * Issue #13 extends the email-hooks planner with a `new-device`
 * variant. Vars:
 *   - recipientName, appName  (shared with all templates)
 *   - deviceLabel              (UA-parser output, e.g. "Chrome on macOS")
 *   - location                 ("City, Country" or "Location unknown")
 *   - ipAddress                (raw — but only present when GeoIP
 *                               returned nothing usable; with location
 *                               we drop the IP from the email body
 *                               for privacy)
 *   - signedInAt               (ISO timestamp string)
 *   - revokeUrl                (link to /me/devices)
 *
 * The runner half (queueing the email + dedup) lives in
 * `device-handling.runner.ts`.
 */
describe("Story · new-device email payload", () => {
  const user: BetterAuthEmailUser = { id: "u1", email: "alice@example.com", name: "Alice" };

  it("builds the canonical { template, to, vars } shape for new-device", () => {
    const out = buildEmailHookPayload({
      kind: "new-device",
      user,
      appName: "Acme",
      deviceLabel: "Chrome on macOS",
      location: "Berlin, Germany",
      ipAddress: "203.0.113.42",
      signedInAt: "2026-04-30T10:00:00.000Z",
      revokeUrl: "https://app.example.com/me/devices",
    });
    expect(out.template).toBe("new-device");
    expect(out.to).toBe("alice@example.com");
    expect(out.vars).toMatchObject({
      recipientName: "Alice",
      appName: "Acme",
      deviceLabel: "Chrome on macOS",
      location: "Berlin, Germany",
      ipAddress: "203.0.113.42",
      signedInAt: "2026-04-30T10:00:00.000Z",
      revokeUrl: "https://app.example.com/me/devices",
    });
  });

  it("falls back to 'Location unknown' when location is empty", () => {
    // GeoIP returned null (private IP, missing .mmdb, etc.) — the
    // mail still ships, the body just shows "Location unknown".
    const out = buildEmailHookPayload({
      kind: "new-device",
      user,
      appName: "Acme",
      deviceLabel: "Safari on iOS",
      location: "",
      ipAddress: "10.0.0.5",
      signedInAt: "2026-04-30T10:00:00.000Z",
      revokeUrl: "https://app.example.com/me/devices",
    });
    expect(out.vars.location).toBe("Location unknown");
  });

  it("requires a non-empty deviceLabel", () => {
    expect(() =>
      buildEmailHookPayload({
        kind: "new-device",
        user,
        appName: "Acme",
        deviceLabel: "",
        location: "Berlin",
        ipAddress: "203.0.113.42",
        signedInAt: "2026-04-30T10:00:00.000Z",
        revokeUrl: "https://app.example.com/me/devices",
      }),
    ).toThrow(/deviceLabel/);
  });

  it("requires a non-empty revokeUrl", () => {
    expect(() =>
      buildEmailHookPayload({
        kind: "new-device",
        user,
        appName: "Acme",
        deviceLabel: "Chrome on macOS",
        location: "Berlin",
        ipAddress: "203.0.113.42",
        signedInAt: "2026-04-30T10:00:00.000Z",
        revokeUrl: "",
      }),
    ).toThrow(/revokeUrl/);
  });
});
