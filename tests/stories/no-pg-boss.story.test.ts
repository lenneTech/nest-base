/**
 * Story · pg-boss removed (BullMQ-only job layer).
 *
 * These assertions prove that all pg-boss code has been purged and
 * that the cleanup-cron modules no longer reference the deleted
 * symbols. Each test must stay GREEN permanently — a regression
 * (re-adding pg-boss) will turn these red immediately.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// 1. Deleted source files must not exist
// ---------------------------------------------------------------------------

describe("Story · pg-boss removal — deleted files must not exist", () => {
  const deletedFiles = [
    "src/core/jobs/pg-boss-job-queue.ts",
    "src/core/jobs/scheduled-job-pgboss-scheduler.ts",
    "src/core/jobs/cleanup-job-planner.ts",
  ];

  for (const file of deletedFiles) {
    it(`${file} does not exist`, () => {
      expect(existsSync(file)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. No live pg-boss import in source tree
// ---------------------------------------------------------------------------

describe("Story · pg-boss removal — no pg-boss imports remain in src/", () => {
  it("no TypeScript source file imports pg-boss", () => {
    const { execSync } = require("child_process");
    // grep exits non-zero when nothing matches — wrap in try/catch
    let output = "";
    try {
      output = execSync(
        "grep -r --include='*.ts' \"from 'pg-boss'\\|from \\\"pg-boss\\\"\" src/",
        { encoding: "utf8" },
      );
    } catch {
      // grep returned exit code 1 (no matches) — that is the expected success path
      output = "";
    }
    expect(output.trim()).toBe("");
  });

  it("no TypeScript source file dynamically imports pg-boss via import()", () => {
    const { execSync } = require("child_process");
    let output = "";
    try {
      output = execSync('grep -r --include="*.ts" "import(\'pg-boss\')" src/', {
        encoding: "utf8",
      });
    } catch {
      output = "";
    }
    expect(output.trim()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 3. FEATURE_JOBS_PG_BOSS must not appear anywhere in src/
// ---------------------------------------------------------------------------

describe("Story · pg-boss removal — FEATURE_JOBS_PG_BOSS env var gone from src/", () => {
  it("no source file references FEATURE_JOBS_PG_BOSS", () => {
    const { execSync } = require("child_process");
    let output = "";
    try {
      output = execSync('grep -r --include="*.ts" "FEATURE_JOBS_PG_BOSS" src/', {
        encoding: "utf8",
      });
    } catch {
      output = "";
    }
    expect(output.trim()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 4. package.json must not list pg-boss
// ---------------------------------------------------------------------------

describe("Story · pg-boss removal — package.json has no pg-boss dependency", () => {
  it("pg-boss is not in dependencies", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["pg-boss"]).toBeUndefined();
    expect(pkg.devDependencies?.["pg-boss"]).toBeUndefined();
    expect(pkg.peerDependencies?.["pg-boss"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. Cleanup crons must not import the deleted cleanup-job-planner
// ---------------------------------------------------------------------------

describe("Story · pg-boss removal — cleanup crons no longer import cleanup-job-planner", () => {
  const cleanupCronFiles = [
    "src/core/throttler/throttler-cleanup.ts",
    "src/core/auth/verification-cleanup.ts",
    "src/core/idempotency/idempotency-cleanup.ts",
    "src/core/geoip/geoip-refresh-cron.ts",
  ];

  for (const file of cleanupCronFiles) {
    it(`${file} does not import cleanup-job-planner`, () => {
      if (!existsSync(file)) return; // file may not exist after deletion
      const src = readFileSync(file, "utf8");
      expect(src).not.toContain("cleanup-job-planner");
      expect(src).not.toContain("scheduled-job-pgboss-scheduler");
      expect(src).not.toContain("PgBossLike");
    });
  }
});

// ---------------------------------------------------------------------------
// 6. Module files must not import pg-boss planner / scheduler
// ---------------------------------------------------------------------------

describe("Story · pg-boss removal — module files clean", () => {
  const moduleFiles = [
    "src/core/jobs/jobs.module.ts",
    "src/core/outbox/outbox.module.ts",
    "src/core/geoip/geoip.module.ts",
    "src/core/email/email-outbox.module.ts",
  ];

  for (const file of moduleFiles) {
    it(`${file} has no pg-boss references`, () => {
      if (!existsSync(file)) return;
      const src = readFileSync(file, "utf8");
      expect(src).not.toContain("pg-boss");
      expect(src).not.toContain("pgBoss");
      expect(src).not.toContain("PgBoss");
      expect(src).not.toContain("FEATURE_JOBS_PG_BOSS");
    });
  }
});
