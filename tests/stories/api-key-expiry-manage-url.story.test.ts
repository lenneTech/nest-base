import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const FACTORY = resolve(
  import.meta.dirname,
  "../../src/core/auth/api-keys/api-key-expiry.factory.ts",
);

describe("Story · api-key expiry manage URL", () => {
  it("points the email CTA at Scalar API docs, not a removed /dev/* path", () => {
    const src = readFileSync(FACTORY, "utf8");
    expect(src).toContain("/api/docs");
    expect(src).not.toContain("/dev/api-keys");
  });
});
