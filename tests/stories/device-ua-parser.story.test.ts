import { describe, expect, it } from "vitest";

import { parseUserAgent } from "../../src/core/devices/ua-parser.js";

/**
 * Story · Device UA-parser planner.
 *
 * `parseUserAgent(ua)` turns a raw User-Agent header into the
 * `{ os, browser, deviceType, label }` projection that the
 * new-device email + `/me/devices` endpoint surface to humans. The
 * underlying `ua-parser-js` library powers the heavy lifting; the
 * planner adds:
 *   - graceful empty / malformed defaults ("Unknown device") so a
 *     bare cURL probe never produces a null label,
 *   - a single composed `label` field — `"<browser> on <os>"` — so
 *     callers don't have to assemble it themselves.
 *
 * The planner is pure (no I/O, no Date) — it's a thin wrapper.
 */
describe("Story · device UA parser", () => {
  it("parses a Chrome on macOS user-agent into structured fields", () => {
    const out = parseUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    );
    expect(out.browser).toMatch(/Chrome/);
    expect(out.os).toMatch(/Mac OS|macOS/);
    expect(out.deviceType).toBe("desktop");
    expect(out.label).toMatch(/Chrome on (Mac OS|macOS)/);
  });

  it("parses a Safari on iPhone user-agent and labels it `mobile`", () => {
    const out = parseUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    );
    expect(out.browser).toMatch(/Safari/);
    expect(out.os).toMatch(/iOS/);
    expect(out.deviceType).toBe("mobile");
  });

  it("parses a Firefox on Linux user-agent", () => {
    const out = parseUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0",
    );
    expect(out.browser).toMatch(/Firefox/);
    expect(out.os).toMatch(/Linux/);
    expect(out.deviceType).toBe("desktop");
  });

  it("falls back to a generic label for an empty user-agent", () => {
    // Better-Auth's `userAgent` is nullish — a sign-in via API client
    // (or a `curl` probe in CI) won't set the header. The planner
    // surfaces the empty-input fallback rather than crashing the
    // hook (which would block the auth flow).
    const out = parseUserAgent("");
    expect(out.label).toBe("Unknown device");
    expect(out.deviceType).toBe("unknown");
    expect(out.browser).toBe("Unknown");
    expect(out.os).toBe("Unknown");
  });

  it("falls back to a generic label for a malformed user-agent", () => {
    const out = parseUserAgent("totally-not-a-ua");
    // ua-parser-js returns undefined fields here; the planner
    // back-fills "Unknown" so downstream renderers (email body,
    // dev-portal table) always have a string to display.
    expect(out.label).toBe("Unknown device");
    expect(out.browser).toBe("Unknown");
    expect(out.os).toBe("Unknown");
  });

  it("treats explicit undefined the same as an empty UA string", () => {
    const out = parseUserAgent(undefined);
    expect(out.label).toBe("Unknown device");
  });

  it("classifies a smart-tv user-agent as `tv`", () => {
    // Picked the deviceType union ahead of full support: tablets,
    // smart-tvs, and console all have ua-parser-js types. The
    // planner just forwards what the lib detected; if it returns
    // an unknown type the planner falls back to "unknown".
    const out = parseUserAgent(
      "Mozilla/5.0 (SMART-TV; X11; Linux armv7l) AppleWebKit/537.42 (KHTML, like Gecko) Chromium/25.0.1349.2 Chrome/25.0.1349.2",
    );
    // Some ua-parser-js versions report "smarttv" specifically; we
    // accept either to stay loose to lib upgrades.
    expect(["tv", "smarttv"]).toContain(out.deviceType);
  });
});
