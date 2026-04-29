import { describe, expect, it } from "vitest";

import { buildDoctorReport } from "../../src/core/dx/doctor.js";

/**
 * Story · `bun run doctor`.
 *
 * Comprehensive environment health check that extends `bun run
 * onboard` with: container statuses, env-var entropy/strength,
 * service pings (Postgres + RustFS + Mailpit), disk space, and
 * Bun/Node compatibility. Pure planner — runner injects all the
 * IO-driven inputs.
 *
 * Output JSON-shaped so CI can parse it (`bun run doctor --json`).
 */
describe("Story · buildDoctorReport", () => {
  function defaults() {
    return {
      bunVersion: "1.3.0",
      requiredBunVersion: "1.1.0",
      envFileExists: true,
      env: {
        DATABASE_URL: "postgres://u:p@localhost:5432/app",
        BETTER_AUTH_SECRET: "long-random-32-chars-minimum-aaaaaaaaaa",
      },
      requiredEnvKeys: ["DATABASE_URL", "BETTER_AUTH_SECRET"],
      containers: { postgres: "running" as const },
      services: { postgres: true },
      diskFreeBytes: 50 * 1024 * 1024 * 1024, // 50 GB
    };
  }

  it("returns ok overall when every check passes", () => {
    const report = buildDoctorReport(defaults());
    expect(report.ok).toBe(true);
    expect(report.summary.blocked).toBe(0);
    for (const step of report.steps) {
      expect(step.status).not.toBe("blocked");
    }
  });

  it("flags Bun version below required as blocked", () => {
    const report = buildDoctorReport({ ...defaults(), bunVersion: "1.0.5" });
    const bunStep = report.steps.find((s) => s.id === "bun");
    expect(bunStep?.status).toBe("blocked");
    expect(report.ok).toBe(false);
  });

  it("flags missing env-vars as blocked with the missing key in the detail", () => {
    const report = buildDoctorReport({
      ...defaults(),
      env: { DATABASE_URL: "postgres://u:p@localhost:5432/app" },
    });
    const envStep = report.steps.find((s) => s.id === "env-keys");
    expect(envStep?.status).toBe("blocked");
    expect(envStep?.detail).toMatch(/BETTER_AUTH_SECRET/);
  });

  it("flags weak secret values as warning (not blocked) — non-breaking", () => {
    const report = buildDoctorReport({
      ...defaults(),
      env: {
        DATABASE_URL: "postgres://u:p@localhost:5432/app",
        BETTER_AUTH_SECRET: "short", // < 32 chars
      },
    });
    const entropyStep = report.steps.find((s) => s.id === "env-strength");
    expect(entropyStep?.status).toBe("warning");
  });

  it("flags placeholder values (`change-me*`) as blocked", () => {
    const report = buildDoctorReport({
      ...defaults(),
      env: {
        DATABASE_URL: "postgres://u:p@localhost:5432/app",
        BETTER_AUTH_SECRET: "change-me-please-rotate-before-prod",
      },
    });
    const entropyStep = report.steps.find((s) => s.id === "env-strength");
    expect(entropyStep?.status).toBe("blocked");
    expect(entropyStep?.detail).toMatch(/change-me/i);
  });

  it("flags Postgres container `not-running` as blocked", () => {
    const report = buildDoctorReport({
      ...defaults(),
      containers: { postgres: "not-running" },
      services: { postgres: false },
    });
    const containerStep = report.steps.find((s) => s.id === "containers");
    expect(containerStep?.status).toBe("blocked");
  });

  it("flags Postgres reachable=false as blocked even when container says running (port unreachable)", () => {
    const report = buildDoctorReport({
      ...defaults(),
      containers: { postgres: "running" },
      services: { postgres: false },
    });
    const probeStep = report.steps.find((s) => s.id === "service-probes");
    expect(probeStep?.status).toBe("blocked");
  });

  it("flags low disk space (< 1GB free) as warning", () => {
    const report = buildDoctorReport({
      ...defaults(),
      diskFreeBytes: 100 * 1024 * 1024, // 100 MB
    });
    const diskStep = report.steps.find((s) => s.id === "disk");
    expect(diskStep?.status).toBe("warning");
  });

  it("includes a summary count breakdown", () => {
    const report = buildDoctorReport(defaults());
    expect(report.summary).toEqual(
      expect.objectContaining({
        ok: expect.any(Number),
        warning: expect.any(Number),
        blocked: expect.any(Number),
      }),
    );
    expect(report.summary.ok + report.summary.warning + report.summary.blocked).toBe(
      report.steps.length,
    );
  });

  it("is JSON-serialisable for the --json runner mode", () => {
    const report = buildDoctorReport(defaults());
    const roundtripped = JSON.parse(JSON.stringify(report));
    expect(roundtripped).toEqual(report);
  });
});
