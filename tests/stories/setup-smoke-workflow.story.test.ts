import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");
const WORKFLOW = resolve(ROOT, ".github/workflows/setup-smoke.yml");

/**
 * Story · setup-smoke workflow guards the consumer bring-up path.
 */
describe("Story · setup-smoke.yml consumer bring-up guards", () => {
  const yaml = readFileSync(WORKFLOW, "utf8");

  it("pulls remote compose images before starting services (skips local postgres build)", () => {
    expect(yaml).toMatch(/docker compose pull --ignore-buildable/);
  });

  it("asserts BullMQ worker health via /health/ready and boot log", () => {
    expect(yaml).toMatch(/checks\.jobs\.status/);
    expect(yaml).toMatch(/BullMQ Worker registration/);
  });

  it("boots via bun src/main.ts (not bun run dev) so portless is out of scope here", () => {
    expect(yaml).toMatch(/bun src\/main\.ts/);
    expect(yaml).not.toMatch(/bun run dev/);
  });
});
