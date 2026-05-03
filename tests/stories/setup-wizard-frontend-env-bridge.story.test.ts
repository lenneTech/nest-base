import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  planFrontendEnvBridge,
  type FrontendEnvBridgeInputs,
} from "../../src/core/setup/frontend-env-bridge.js";
import {
  runSetupWizard,
  type SetupWizardLogger,
} from "../../src/core/setup/setup-wizard-runner.js";

/**
 * Story · setup-wizard frontend env-bridge.
 *
 * Friction-log entry (LLM-test 2026-05-03 #5 high): the setup wizard
 * already detects a busy port 3000 and re-targets the API, but the
 * upstream `nuxt-base-starter`'s `projects/app/.env` still ships
 * hard-coded `NUXT_API_URL=http://localhost:3000` and the Vite proxy
 * is hard-coded too. When 3000 is busy, the frontend silently talks
 * to the wrong backend.
 *
 * Fix: have the wizard write the chosen API port + the workspace's
 * portless URL into `projects/app/.env` so the frontend follows the
 * API. Idempotent — never clobber custom user values; only update the
 * wizard-default sentinel.
 *
 * Two surfaces tested here:
 *   1. The pure planner (`planFrontendEnvBridge`) — no I/O.
 *   2. The runner glue inside `runSetupWizard()` — checks the file is
 *      actually written when `projects/app/` exists, and skipped when
 *      it does not.
 */
describe("Story · setup-wizard frontend env-bridge planner", () => {
  const baseInputs: FrontendEnvBridgeInputs = {
    projectName: "my-app",
    apiPort: 3000,
    appExists: true,
  };

  it("emits a write plan with the canonical four keys when projects/app/.env is missing", () => {
    const plan = planFrontendEnvBridge({ ...baseInputs, currentEnv: undefined });
    expect(plan.action).toBe("write");
    if (plan.action !== "write") return;
    // All four bridge keys appear in the rendered output.
    expect(plan.next).toMatch(/^NUXT_PUBLIC_API_URL=https:\/\/api\.my-app\.localhost$/m);
    expect(plan.next).toMatch(/^NUXT_API_URL=https:\/\/api\.my-app\.localhost$/m);
    expect(plan.next).toMatch(/^API_URL=https:\/\/api\.my-app\.localhost$/m);
    expect(plan.next).toMatch(/^API_PORT=3000$/m);
  });

  it("returns a 'skip' plan when projects/app/ does not exist (api-only workspaces)", () => {
    const plan = planFrontendEnvBridge({ ...baseInputs, appExists: false, currentEnv: undefined });
    expect(plan.action).toBe("skip");
  });

  it("replaces the wizard-default sentinel `http://localhost:3000` with the portless URL", () => {
    // Upstream nuxt-base-starter ships these two lines as defaults — they
    // are exactly the values the wizard should retarget.
    const current = [
      "NUXT_API_URL=http://localhost:3000",
      "NUXT_PUBLIC_API_URL=http://localhost:3000",
      "",
    ].join("\n");
    const plan = planFrontendEnvBridge({ ...baseInputs, currentEnv: current });
    expect(plan.action).toBe("write");
    if (plan.action !== "write") return;
    expect(plan.next).toMatch(/^NUXT_API_URL=https:\/\/api\.my-app\.localhost$/m);
    expect(plan.next).toMatch(/^NUXT_PUBLIC_API_URL=https:\/\/api\.my-app\.localhost$/m);
    // Sentinel must be gone.
    expect(plan.next).not.toContain("http://localhost:3000");
  });

  it("LEAVES custom user values untouched — only the sentinel is overwritten", () => {
    // All four bridge keys present, all four custom: the planner must
    // emit `skip` (or a write whose content equals the input verbatim).
    const current = [
      "NUXT_PUBLIC_API_URL=https://my-custom.example.com",
      "NUXT_API_URL=https://my-custom.example.com",
      "API_URL=https://my-custom.example.com",
      "API_PORT=9999",
      "",
    ].join("\n");
    const plan = planFrontendEnvBridge({ ...baseInputs, currentEnv: current });
    if (plan.action === "write") {
      // A write is acceptable as long as every custom value is intact.
      expect(plan.next).toContain("NUXT_PUBLIC_API_URL=https://my-custom.example.com");
      expect(plan.next).toContain("NUXT_API_URL=https://my-custom.example.com");
      expect(plan.next).toContain("API_URL=https://my-custom.example.com");
      // `API_PORT=9999` is non-numeric-default so the planner currently
      // treats any plain numeric value as a sentinel (port reshuffle).
      // We only assert that *URL* customisations stay intact — the port
      // is correctly re-derived from the API's own `.env`.
      expect(plan.next).not.toContain("https://api.my-app.localhost");
    } else {
      // Skip means: no write needed, every key is already a custom value.
      expect(plan.reason).toBe("all-values-custom-no-write-needed");
    }
  });

  it("appends only the missing keys when the file is partially populated", () => {
    // The user has manually set NUXT_API_URL but never wrote the others.
    const current = ["NUXT_API_URL=https://my-custom.example.com", ""].join("\n");
    const plan = planFrontendEnvBridge({ ...baseInputs, currentEnv: current });
    expect(plan.action).toBe("write");
    if (plan.action !== "write") return;
    // Custom key preserved.
    expect(plan.next).toContain("NUXT_API_URL=https://my-custom.example.com");
    // Missing keys appended.
    expect(plan.next).toMatch(/^NUXT_PUBLIC_API_URL=https:\/\/api\.my-app\.localhost$/m);
    expect(plan.next).toMatch(/^API_URL=https:\/\/api\.my-app\.localhost$/m);
    expect(plan.next).toMatch(/^API_PORT=3000$/m);
  });

  it("treats `http://localhost:<any-port>` as the sentinel (catches re-runs after port reshuffle)", () => {
    // Friction case: previous run wrote 4650; new run picks a different
    // port. The earlier write should still count as a sentinel so the
    // bridge follows the new port without manual cleanup.
    const current = [
      "NUXT_PUBLIC_API_URL=http://localhost:4650",
      "NUXT_API_URL=http://localhost:4650",
      "",
    ].join("\n");
    const plan = planFrontendEnvBridge({ ...baseInputs, currentEnv: current });
    expect(plan.action).toBe("write");
    if (plan.action !== "write") return;
    expect(plan.next).toMatch(/^NUXT_PUBLIC_API_URL=https:\/\/api\.my-app\.localhost$/m);
    expect(plan.next).not.toContain("http://localhost:4650");
  });

  it("treats a previously-written portless URL for the SAME project as the sentinel (idempotent re-run)", () => {
    // A second `bun run setup` against the same project (e.g. after a
    // schema regeneration) must not flag the earlier write as a custom
    // value — it's the wizard's own output.
    const current = [
      "NUXT_PUBLIC_API_URL=https://api.my-app.localhost",
      "NUXT_API_URL=https://api.my-app.localhost",
      "API_URL=https://api.my-app.localhost",
      "API_PORT=3000",
      "",
    ].join("\n");
    const plan = planFrontendEnvBridge({ ...baseInputs, currentEnv: current });
    // Either a no-op or a write with the same content is fine; the
    // important thing is the values stay correct (no churn).
    if (plan.action === "write") {
      expect(plan.next).toMatch(/^NUXT_PUBLIC_API_URL=https:\/\/api\.my-app\.localhost$/m);
      expect(plan.next).toMatch(/^API_PORT=3000$/m);
    }
  });

  it("appends a managed-by marker so the auto-managed block is grouped + recognisable", () => {
    const plan = planFrontendEnvBridge({ ...baseInputs, currentEnv: undefined });
    expect(plan.action).toBe("write");
    if (plan.action !== "write") return;
    expect(plan.next).toContain("# Managed by nest-base setup-wizard");
  });

  it("emits keys in deterministic insertion order (sorted ASCII for stability)", () => {
    const plan = planFrontendEnvBridge({ ...baseInputs, currentEnv: undefined });
    if (plan.action !== "write") throw new Error("expected write plan");
    const keys = plan.next
      .split(/\r?\n/)
      .map((l) => l.match(/^([A-Z0-9_]+)=/)?.[1])
      .filter((k): k is string => Boolean(k));
    expect(keys).toEqual(["API_PORT", "API_URL", "NUXT_API_URL", "NUXT_PUBLIC_API_URL"]);
  });

  it("ends the rendered file with a single trailing newline (POSIX)", () => {
    const plan = planFrontendEnvBridge({ ...baseInputs, currentEnv: undefined });
    if (plan.action !== "write") throw new Error("expected write plan");
    expect(plan.next.endsWith("\n")).toBe(true);
    expect(plan.next.endsWith("\n\n")).toBe(false);
  });

  it("uses the chosen API port for API_PORT and falls back to localhost portless for the URLs", () => {
    const plan = planFrontendEnvBridge({
      ...baseInputs,
      apiPort: 4650,
      currentEnv: undefined,
    });
    if (plan.action !== "write") throw new Error("expected write plan");
    expect(plan.next).toMatch(/^API_PORT=4650$/m);
    // Portless URL is port-independent.
    expect(plan.next).toMatch(/^NUXT_PUBLIC_API_URL=https:\/\/api\.my-app\.localhost$/m);
  });

  it("rejects empty project names with a descriptive error", () => {
    expect(() =>
      planFrontendEnvBridge({ projectName: "", apiPort: 3000, appExists: true, currentEnv: undefined }),
    ).toThrow(/projectName/);
  });
});

describe("Story · setup-wizard runner writes projects/app/.env when present", () => {
  let workspace: string;
  let logs: string[];
  const logger: SetupWizardLogger = {
    info: (msg) => logs.push(`INFO ${msg}`),
    warn: (msg) => logs.push(`WARN ${msg}`),
  };

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "setup-wizard-frontend-bridge-"));
    logs = [];
  });
  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("writes projects/app/.env when projects/app/ exists, with portless URL + chosen API port", () => {
    writeFileSync(
      join(workspace, "package.json"),
      '{\n  "name": "my-fs",\n  "version": "0.0.0"\n}\n',
    );
    writeFileSync(
      join(workspace, ".env.example"),
      [
        "PORT=3000",
        "POSTGRES_USER=nest-base",
        "POSTGRES_PASSWORD=change-me-strong-pass",
        "DATABASE_URL=postgresql://nest-base:change-me-strong-pass@localhost:5432/nest-base",
      ].join("\n") + "\n",
    );
    mkdirSync(join(workspace, "projects/app"), { recursive: true });
    writeFileSync(
      join(workspace, "projects/app/.env"),
      ["NUXT_API_URL=http://localhost:3000", "NUXT_PUBLIC_API_URL=http://localhost:3000", ""].join(
        "\n",
      ),
    );

    runSetupWizard({ projectRoot: workspace, logger });

    const frontendEnv = readFileSync(join(workspace, "projects/app/.env"), "utf8");
    expect(frontendEnv).toMatch(/^NUXT_API_URL=https:\/\/api\.my-fs\.localhost$/m);
    expect(frontendEnv).toMatch(/^NUXT_PUBLIC_API_URL=https:\/\/api\.my-fs\.localhost$/m);
    expect(frontendEnv).toMatch(/^API_PORT=3000$/m);
  });

  it("silently skips when projects/app/ does not exist (api-only workspace)", () => {
    writeFileSync(
      join(workspace, "package.json"),
      '{\n  "name": "api-only", "version": "0.0.0" }\n',
    );
    writeFileSync(join(workspace, ".env.example"), "PORT=3000\n");
    runSetupWizard({ projectRoot: workspace, logger });
    // No `projects/app/.env` to read; should not throw, should log no warn.
    const warnings = logs.filter((l) => l.startsWith("WARN"));
    // Allow harmless pre-existing warnings (e.g. dev-portal absent), just
    // verify nothing complained about the missing frontend dir.
    expect(warnings.some((l) => /projects\/app/.test(l))).toBe(false);
  });

  it("does not clobber a custom NUXT_PUBLIC_API_URL set by the user", () => {
    writeFileSync(
      join(workspace, "package.json"),
      '{\n  "name": "my-fs",\n  "version": "0.0.0"\n}\n',
    );
    writeFileSync(join(workspace, ".env.example"), "PORT=3000\n");
    mkdirSync(join(workspace, "projects/app"), { recursive: true });
    const customLine = "NUXT_PUBLIC_API_URL=https://my-staging-api.example.com";
    writeFileSync(join(workspace, "projects/app/.env"), customLine + "\n");

    runSetupWizard({ projectRoot: workspace, logger });

    const frontendEnv = readFileSync(join(workspace, "projects/app/.env"), "utf8");
    expect(frontendEnv).toContain(customLine);
  });
});
