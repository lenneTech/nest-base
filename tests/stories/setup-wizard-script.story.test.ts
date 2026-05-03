import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  runSetupWizard,
  type SetupWizardLogger,
} from "../../src/core/setup/setup-wizard-runner.js";

/**
 * Story · `bun run setup` runner I/O behaviour.
 *
 * Tests pin the real file-system contract:
 *   - reads `.env.example` from the project root
 *   - writes `.env` with substituted secrets
 *   - is idempotent: refuses to overwrite an existing `.env`
 *   - if `.env.example` is missing, generates one from the planner
 *     so a fresh checkout can run the command without manual setup.
 */
describe("Story · bun run setup runner I/O", () => {
  let workspace: string;
  let logs: string[];
  const logger: SetupWizardLogger = {
    info: (msg) => logs.push(`INFO ${msg}`),
    warn: (msg) => logs.push(`WARN ${msg}`),
  };

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "setup-wizard-"));
    logs = [];
  });
  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("writes a .env file with substituted secrets when .env.example exists", () => {
    writeFileSync(
      join(workspace, ".env.example"),
      [
        "POSTGRES_USER=app",
        "POSTGRES_PASSWORD=change-me-strong-pass",
        "BETTER_AUTH_SECRET=change-me-32-chars-minimum-XXXXXX",
        "NODE_ENV=development",
      ].join("\n") + "\n",
    );
    const result = runSetupWizard({ projectRoot: workspace, logger });
    expect(result.envPath).toBe(join(workspace, ".env"));
    expect(result.created).toBe(true);

    const written = readFileSync(result.envPath, "utf8");
    expect(written).not.toContain("change-me-strong-pass");
    expect(written).not.toContain("change-me-32-chars-minimum-XXXXXX");
    expect(written).toMatch(/^NODE_ENV=development$/m);
  });

  it("refuses to overwrite an existing .env (idempotent, no clobber)", () => {
    writeFileSync(join(workspace, ".env.example"), "NODE_ENV=development\n");
    writeFileSync(join(workspace, ".env"), "EXISTING=keep-me\n");

    const result = runSetupWizard({ projectRoot: workspace, logger });
    expect(result.created).toBe(false);
    expect(readFileSync(join(workspace, ".env"), "utf8")).toBe("EXISTING=keep-me\n");
    expect(logs.some((l) => /already exists/.test(l))).toBe(true);
  });

  it("generates .env.example from the default planner when missing", () => {
    // No .env.example present.
    const result = runSetupWizard({ projectRoot: workspace, logger });
    expect(existsSync(join(workspace, ".env.example"))).toBe(true);
    expect(result.created).toBe(true);
    const example = readFileSync(join(workspace, ".env.example"), "utf8");
    expect(example).toMatch(/^DATABASE_URL=/m);
    expect(example).toMatch(/^BETTER_AUTH_SECRET=/m);
  });

  it("returns the path to the generated .env so callers can chain", () => {
    writeFileSync(join(workspace, ".env.example"), "NODE_ENV=development\n");
    const result = runSetupWizard({ projectRoot: workspace, logger });
    expect(result.envPath).toBe(join(workspace, ".env"));
  });

  it('reads package.json["name"] and tailors project-scoped vars in .env', () => {
    writeFileSync(
      join(workspace, "package.json"),
      '{\n  "name": "my-app",\n  "version": "0.0.0"\n}\n',
    );
    writeFileSync(
      join(workspace, ".env.example"),
      [
        "APP_BASE_URL=http://localhost:3000",
        "POSTGRES_USER=nest-base",
        "POSTGRES_DB=nest-base",
        "POSTGRES_PASSWORD=change-me-strong-pass",
        "DATABASE_URL=postgresql://nest-base:change-me-strong-pass@localhost:5432/nest-base",
      ].join("\n") + "\n",
    );
    runSetupWizard({ projectRoot: workspace, logger });
    const env = readFileSync(join(workspace, ".env"), "utf8");
    expect(env).toMatch(/^APP_BASE_URL=https:\/\/api\.my-app\.localhost$/m);
    expect(env).toMatch(/^POSTGRES_USER=my-app$/m);
    expect(env).toMatch(/^POSTGRES_DB=my-app$/m);
    expect(env).toContain("postgresql://my-app:");
    expect(env).toContain("@localhost:5432/my-app");
  });

  // Friction-log entry 14:21: two workspaces named the same in
  // different cache dirs collided on the same docker volume because
  // `COMPOSE_PROJECT_NAME` was just `kebabCase(workspaceName)`. Fresh
  // inits now bake a per-workspace path-hash so the namespace is
  // unique. Pre-existing `.env` files (with a non-hashed name) are
  // preserved — only fresh inits get the hashed namespace.
  describe("per-workspace COMPOSE_PROJECT_NAME hash", () => {
    it("bakes `<project>-<6hex>` into the freshly written .env", () => {
      writeFileSync(
        join(workspace, "package.json"),
        '{\n  "name": "my-next-fs",\n  "version": "0.0.0"\n}\n',
      );
      writeFileSync(
        join(workspace, ".env.example"),
        ["COMPOSE_PROJECT_NAME=nest-base", "NODE_ENV=development"].join("\n") + "\n",
      );
      runSetupWizard({ projectRoot: workspace, logger });
      const env = readFileSync(join(workspace, ".env"), "utf8");
      expect(env).toMatch(/^COMPOSE_PROJECT_NAME=my-next-fs-[0-9a-f]{6}$/m);
    });

    it("produces DIFFERENT compose names for the same project in two different paths", () => {
      const wsA = mkdtempSync(join(tmpdir(), "setup-wizard-hashA-"));
      const wsB = mkdtempSync(join(tmpdir(), "setup-wizard-hashB-"));
      try {
        for (const ws of [wsA, wsB]) {
          writeFileSync(
            join(ws, "package.json"),
            '{\n  "name": "shared-name",\n  "version": "0.0.0"\n}\n',
          );
          writeFileSync(
            join(ws, ".env.example"),
            ["COMPOSE_PROJECT_NAME=nest-base"].join("\n") + "\n",
          );
          runSetupWizard({ projectRoot: ws, logger });
        }
        const a = readFileSync(join(wsA, ".env"), "utf8").match(
          /^COMPOSE_PROJECT_NAME=(.*)$/m,
        )?.[1];
        const b = readFileSync(join(wsB, ".env"), "utf8").match(
          /^COMPOSE_PROJECT_NAME=(.*)$/m,
        )?.[1];
        expect(a).toBeDefined();
        expect(b).toBeDefined();
        expect(a).not.toBe(b);
        expect(a!.startsWith("shared-name-")).toBe(true);
        expect(b!.startsWith("shared-name-")).toBe(true);
      } finally {
        rmSync(wsA, { recursive: true, force: true });
        rmSync(wsB, { recursive: true, force: true });
      }
    });

    it("preserves an existing legacy non-hashed COMPOSE_PROJECT_NAME (no rewrite)", () => {
      // Pre-existing `.env` with the legacy non-hashed name. The
      // runner refuses to overwrite an existing `.env` at all, so the
      // legacy line stays exactly as the operator wrote it.
      writeFileSync(
        join(workspace, "package.json"),
        '{\n  "name": "my-next-fs",\n  "version": "0.0.0"\n}\n',
      );
      writeFileSync(join(workspace, ".env.example"), "COMPOSE_PROJECT_NAME=nest-base\n");
      writeFileSync(join(workspace, ".env"), "COMPOSE_PROJECT_NAME=my-next-fs\n");

      const result = runSetupWizard({ projectRoot: workspace, logger });
      expect(result.created).toBe(false);
      const env = readFileSync(join(workspace, ".env"), "utf8");
      expect(env).toBe("COMPOSE_PROJECT_NAME=my-next-fs\n");
    });
  });
});
