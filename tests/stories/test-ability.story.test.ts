import { describe, expect, it } from "vitest";

import {
  parseTestAbilityHeader,
  parseTestAbilityHeaderForRequest,
} from "../../src/core/permissions/test-ability.js";

/**
 * Story · Test-Ability helper.
 *
 * Pure planner that turns an `X-Test-Ability` header value into a
 * CASL `Ability`. Honoured ONLY when `NODE_ENV === "test"`. Lets
 * e2e specs pre-seed an ability so they don't have to drive the
 * full Better-Auth sign-in flow just to test a controller behind
 * `@Can()`.
 *
 * Header values:
 *   - `"full"`        → manage:all (admin-equivalent)
 *   - JSON array      → list of `{action, subject, conditions?, fields?, inverted?}`
 *   - anything else   → null (no override)
 *
 * Out-of-test environments always return null — the helper is a
 * deliberate test-only hatch, never a production bypass.
 */
describe("Story · parseTestAbilityHeader", () => {
  it("returns null when env is not 'test' (production safety)", () => {
    expect(parseTestAbilityHeader("full", "development")).toBeNull();
    expect(parseTestAbilityHeader("full", "production")).toBeNull();
  });

  it("returns null when header is missing or empty", () => {
    expect(parseTestAbilityHeader(undefined, "test")).toBeNull();
    expect(parseTestAbilityHeader("", "test")).toBeNull();
  });

  it('returns a manage:all ability for `"full"`', () => {
    const ability = parseTestAbilityHeader("full", "test");
    expect(ability).not.toBeNull();
    expect(ability!.can("read", "Anything")).toBe(true);
    expect(ability!.can("delete", "Account")).toBe(true);
    expect(ability!.can("write", "PowerSync")).toBe(true);
  });

  it("returns a typed ability when given a JSON rule list", () => {
    const json = JSON.stringify([{ action: "read", subject: "Search" }]);
    const ability = parseTestAbilityHeader(json, "test");
    expect(ability).not.toBeNull();
    expect(ability!.can("read", "Search")).toBe(true);
    expect(ability!.can("write", "Search")).toBe(false);
  });

  it("returns null on malformed JSON (graceful failure, not crash)", () => {
    expect(parseTestAbilityHeader("not json", "test")).toBeNull();
    expect(parseTestAbilityHeader("[}", "test")).toBeNull();
  });

  it("returns null on JSON that is not a rule array", () => {
    expect(parseTestAbilityHeader('{"action": "read"}', "test")).toBeNull();
    expect(parseTestAbilityHeader('"just a string"', "test")).toBeNull();
    expect(parseTestAbilityHeader("[1, 2, 3]", "test")).toBeNull();
  });

  it("normalises array-form headers (supertest forwards as string[])", () => {
    const ability = parseTestAbilityHeader(["full", "ignored-second"], "test");
    expect(ability).not.toBeNull();
    expect(ability!.can("read", "Anything")).toBe(true);
  });
});

/**
 * Story · `parseTestAbilityHeaderForRequest` (cached-env variant).
 *
 * The middleware-facing entry point reads `NODE_ENV` exactly once,
 * at module load time (when the test runner bootstraps and globalSetup
 * has already set `NODE_ENV=test`). Subsequent runtime mutations of
 * `process.env.NODE_ENV` from individual specs do NOT change the
 * cached value, so a spec that flips to "development" / "production"
 * mid-suite can never silently disable the test-ability hatch for
 * the next spec in the same worker.
 *
 * Out-of-band guarantee: even if a previous spec failed before its
 * `afterAll` reset, the test-ability hatch keeps working because
 * the env was captured at module load.
 */
describe("Story · parseTestAbilityHeaderForRequest (cached env)", () => {
  it("honours the header even after process.env.NODE_ENV is mutated mid-suite", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const ability = parseTestAbilityHeaderForRequest("full");
      expect(ability).not.toBeNull();
      expect(ability!.can("manage", "all")).toBe(true);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("returns null when the header is missing (cached env or not)", () => {
    expect(parseTestAbilityHeaderForRequest(undefined)).toBeNull();
    expect(parseTestAbilityHeaderForRequest("")).toBeNull();
  });

  it("parses JSON rule arrays the same way as the explicit-env variant", () => {
    const json = JSON.stringify([{ action: "read", subject: "Search" }]);
    const ability = parseTestAbilityHeaderForRequest(json);
    expect(ability).not.toBeNull();
    expect(ability!.can("read", "Search")).toBe(true);
    expect(ability!.can("write", "Search")).toBe(false);
  });
});
