import { describe, expect, it } from "vitest";

import { checkEnvPrerequisites, renderEnvBanner } from "../../src/core/setup/env-prerequisites.js";

describe("Story · ENV Prerequisites", () => {
  describe("checkEnvPrerequisites", () => {
    it("ok=true when all required vars are present and non-placeholder", () => {
      const plan = checkEnvPrerequisites({
        env: {
          DATABASE_URL: "postgresql://u:p@localhost:5432/db",
          BETTER_AUTH_SECRET: "real-secret-thats-long-enough",
        },
        envFileExists: true,
        envExampleExists: true,
      });
      expect(plan.ok).toBe(true);
      expect(plan.missing).toEqual([]);
    });

    it("flags empty values as missing", () => {
      const plan = checkEnvPrerequisites({
        env: { DATABASE_URL: "", BETTER_AUTH_SECRET: "x" },
        envFileExists: true,
        envExampleExists: true,
      });
      expect(plan.ok).toBe(false);
      expect(plan.missing.map((m) => m.key)).toContain("DATABASE_URL");
    });

    it('flags "change-me-*" placeholder values as missing', () => {
      const plan = checkEnvPrerequisites({
        env: {
          DATABASE_URL: "postgresql://u:p@localhost:5432/db",
          BETTER_AUTH_SECRET: "change-me-32-chars-minimum-XXXXXX",
        },
        envFileExists: true,
        envExampleExists: true,
      });
      expect(plan.ok).toBe(false);
      expect(plan.missing.map((m) => m.key)).toEqual(["BETTER_AUTH_SECRET"]);
    });

    it("envFileMissing is set when .env doesn't exist", () => {
      const plan = checkEnvPrerequisites({
        env: {},
        envFileExists: false,
        envExampleExists: true,
      });
      expect(plan.envFileMissing).toBe(true);
      expect(plan.envExampleMissing).toBe(false);
    });

    it("envExampleMissing is set when both .env and .env.example are absent", () => {
      const plan = checkEnvPrerequisites({
        env: {},
        envFileExists: false,
        envExampleExists: false,
      });
      expect(plan.envExampleMissing).toBe(true);
    });
  });

  describe("renderEnvBanner", () => {
    it("suggests `bun run setup` when .env is missing (covers both file states)", () => {
      // bun run setup auto-creates .env.example (if missing) and .env
      // — single command for both flavours. No `cp` step needed.
      for (const envExampleMissing of [true, false]) {
        const text = renderEnvBanner({
          ok: false,
          missing: [],
          envFileMissing: true,
          envExampleMissing,
        });
        expect(text).toContain("bun run setup");
        expect(text).toContain("No .env file found");
      }
    });

    it("never suggests `cp .env.example .env` (setup refuses to overwrite an existing .env)", () => {
      const text = renderEnvBanner({
        ok: false,
        missing: [],
        envFileMissing: true,
        envExampleMissing: false,
      });
      expect(text).not.toContain("cp .env.example");
    });

    it("lists each missing key with its hint when .env exists but is incomplete", () => {
      const text = renderEnvBanner({
        ok: false,
        missing: [
          { key: "DATABASE_URL", hint: "Postgres connection string." },
          { key: "BETTER_AUTH_SECRET", hint: "32 bytes." },
        ],
        envFileMissing: false,
        envExampleMissing: false,
      });
      expect(text).toContain("DATABASE_URL");
      expect(text).toContain("Postgres connection string");
      expect(text).toContain("BETTER_AUTH_SECRET");
      expect(text).toContain("32 bytes");
    });

    it("contains ANSI escape codes (colours)", () => {
      const text = renderEnvBanner({
        ok: false,
        missing: [],
        envFileMissing: true,
        envExampleMissing: false,
      });
      expect(text).toContain("\x1b[");
    });

    it("ends with the next-step hint", () => {
      const text = renderEnvBanner({
        ok: false,
        missing: [],
        envFileMissing: true,
        envExampleMissing: true,
      });
      expect(text).toMatch(/run.*bun run dev.*again/i);
    });
  });
});
