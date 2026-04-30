import { describe, expect, it } from "vitest";

import { buildCurlCommand } from "../../src/core/webhooks/inspector-curl.js";

/**
 * Story · Webhook-Inspector "Copy curl".
 *
 * Pure planner: given a delivery's url, headers, body, generates a
 * shell-safe curl command that reproduces the request byte-for-byte.
 * Worker emits the same headers, so a copy-paste curl is a useful
 * receiver-debugging tool.
 */

describe("Story · Webhook-Inspector curl builder", () => {
  it("emits a POST request with the body via --data-binary", () => {
    const cmd = buildCurlCommand({
      url: "https://example.com/hook",
      method: "POST",
      headers: {},
      body: '{"event":"foo"}',
    });
    expect(cmd).toContain("curl ");
    expect(cmd).toContain("-X POST");
    expect(cmd).toContain("'https://example.com/hook'");
    expect(cmd).toContain("--data-binary");
    expect(cmd).toContain('{"event":"foo"}');
  });

  it("emits one -H per header, sorted by key", () => {
    const cmd = buildCurlCommand({
      url: "https://example.com/hook",
      method: "POST",
      headers: {
        "x-webhook-id": "evt-123",
        "content-type": "application/json",
      },
      body: "{}",
    });
    const expected = cmd.indexOf("'content-type:");
    const found = cmd.indexOf("'x-webhook-id:");
    expect(expected).toBeGreaterThan(0);
    expect(found).toBeGreaterThan(expected);
  });

  it("escapes single quotes in body and headers", () => {
    const cmd = buildCurlCommand({
      url: "https://example.com/hook",
      method: "POST",
      headers: { "x-quote": "it's ok" },
      body: "isn't",
    });
    // Single quotes are closed and re-opened: '\''
    expect(cmd).toContain("'\\''");
    // No naked single quote inside payload.
    expect(cmd).not.toMatch(/'isn't'/);
  });

  it("defaults to POST when method is missing", () => {
    const cmd = buildCurlCommand({
      url: "https://example.com/hook",
      headers: {},
      body: "{}",
    });
    expect(cmd).toContain("-X POST");
  });

  it("returns a single-line shell-safe command", () => {
    const cmd = buildCurlCommand({
      url: "https://example.com/hook",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"x":1}',
    });
    expect(cmd.includes("\n")).toBe(false);
  });
});
