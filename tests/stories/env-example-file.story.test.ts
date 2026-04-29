import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildDefaultEnvExample } from "../../src/core/setup/setup-wizard.js";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Story · `.env.example` is committed and matches the planner output.
 *
 * The committed file is the single source of truth for new contributors
 * — `bun run setup` copies it to `.env` and substitutes secrets. We
 * regenerate-on-demand from the planner; this regression test fails
 * loudly the moment the file drifts from what the planner emits, so
 * nobody has to remember to re-run a doc script after editing the
 * planner.
 */
describe("Story · committed .env.example", () => {
  const path = resolve(ROOT, ".env.example");

  it("exists at the repo root", () => {
    expect(existsSync(path), ".env.example must be committed at repo root").toBe(true);
  });

  it("matches `buildDefaultEnvExample()` byte-for-byte (regenerate via the runner)", () => {
    const committed = readFileSync(path, "utf8");
    expect(committed).toBe(buildDefaultEnvExample());
  });

  it("lists every always-required key the runtime reads", () => {
    const committed = readFileSync(path, "utf8");
    for (const key of [
      "NODE_ENV",
      "PORT",
      "HOST",
      "APP_BASE_URL",
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "POSTGRES_USER",
      "POSTGRES_PASSWORD",
      "POSTGRES_DB",
      "S3_ACCESS_KEY",
      "S3_SECRET_KEY",
      "SYSTEM_SETUP_ADMIN_EMAIL",
      "SYSTEM_SETUP_ADMIN_PASSWORD",
      "ERROR_DOC_BASE_URL",
    ]) {
      expect(committed, `${key} missing from .env.example`).toMatch(new RegExp(`^${key}=`, "m"));
    }
  });

  it("the committed file has all-features-on coverage (PowerSync + Email + FieldEnc)", () => {
    const committed = readFileSync(path, "utf8");
    expect(committed).toMatch(/^POWERSYNC_DB_PASSWORD=/m);
    expect(committed).toMatch(/^FIELD_ENCRYPTION_KEK=/m);
    // Email defaults to SMTP — both shapes appear: at minimum SMTP_HOST.
    expect(committed).toMatch(/^SMTP_HOST=|^BREVO_API_KEY=/m);
  });
});
