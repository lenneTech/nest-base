import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildRustFsContainerConfig,
  type RustFsTestContainerConfig,
} from "../../tests/lib/rustfs-container.js";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Story · Test-Containers-Setup.
 *
 * Two pieces:
 *
 *   - The Vitest globalSetup at `tests/global-setup.ts` is the
 *     entry point for every integration test that needs a real
 *     Postgres. We pin the load-bearing Postgres bits here so a
 *     future cleanup can't drop testcontainers in favour of a
 *     CI-only docker-compose dance and silently halve coverage.
 *
 *   - `tests/lib/rustfs-container.ts` ships an
 *     `@testcontainers/...`-compatible config builder for RustFS
 *     so file-storage integration tests can spin up an S3-like
 *     endpoint locally. The builder is pure; the runner that
 *     starts the actual container layers on top.
 */
describe("Story · Test-Containers-Setup", () => {
  describe("global-setup.ts", () => {
    function read(): string {
      const p = resolve(ROOT, "tests/global-setup.ts");
      expect(existsSync(p), "tests/global-setup.ts must exist").toBe(true);
      return readFileSync(p, "utf8");
    }

    it("starts a real Postgres testcontainer via @testcontainers/postgresql", () => {
      const src = read();
      expect(src).toMatch(/PostgreSqlContainer/);
      expect(src).toMatch(/@testcontainers\/postgresql/);
    });

    it("uses postgres:18-alpine to mirror the dev compose + CI service", () => {
      expect(read()).toMatch(/postgres:18-alpine/);
    });

    it("exposes DATABASE_URL into process.env", () => {
      expect(read()).toMatch(/DATABASE_URL/);
    });

    it("delegates the database-strategy decision to the pure planTestDatabaseStrategy() planner", () => {
      const src = read();
      // Replaces the legacy `if (!process.env.DATABASE_URL)` branch.
      // The planner is the single source of truth for "spawn vs
      // reuse"; globalSetup just executes its plan. CI service
      // containers route through `TEST_DATABASE_URL`; destructive
      // dev-DB reuse routes through `TEST_REUSE_DEV_DB=1`.
      expect(src).toMatch(/planTestDatabaseStrategy/);
      expect(src).toMatch(/strategy === "reuse-existing"/);
    });

    it("stops the container in the teardown callback", () => {
      const src = read();
      expect(src).toMatch(/container\.stop\(\)/);
    });

    /**
     * Regression: the `tests/dev-hub.e2e-spec.ts` suite hits
     * `/dev/static/main.js` and `/dev/static/tokens.css`, which the
     * controller serves from `dist/dev-portal/`. That directory only
     * exists after `bun run build:dev-portal`. Fresh installs would
     * fail the two asset tests until someone remembered to run the
     * build by hand. Global-setup builds the bundle on demand so the
     * 6-gate sequence stays self-healing on a fresh clone.
     */
    it("ensures the dev-portal SPA bundle is built before tests run", () => {
      const src = read();
      expect(src).toMatch(/dist\/dev-portal\/main\.js/);
      expect(src).toMatch(/dist\/dev-portal\/tokens\.css/);
      expect(src).toMatch(/build:dev-portal/);
    });

    it("skips the dev-portal build when the bundle already exists (no-op fast-path)", () => {
      const src = read();
      // Both artefact paths must be checked before spawning bun, so
      // a warm cache pays zero rebuild cost on every test run.
      expect(src).toMatch(/existsSync\(entry\)\s*&&\s*existsSync\(tokens\)/);
    });
  });

  describe("rustfs-container builder", () => {
    function config(overrides: Partial<RustFsTestContainerConfig> = {}): RustFsTestContainerConfig {
      return buildRustFsContainerConfig(overrides);
    }

    it("exposes a default RustFS image tag", () => {
      expect(config().image).toMatch(/rustfs/);
    });

    it("uses port 9000 (S3 default) as the exposed port", () => {
      expect(config().exposedPort).toBe(9000);
    });

    it("returns a default access-key + secret-key pair", () => {
      const c = config();
      expect(c.accessKey).toMatch(/^[A-Za-z0-9]+$/);
      expect(c.secretKey).toMatch(/^[A-Za-z0-9]+$/);
      expect(c.accessKey.length).toBeGreaterThanOrEqual(8);
      expect(c.secretKey.length).toBeGreaterThanOrEqual(16);
    });

    it("sets the env vars RustFS expects (RUSTFS_ACCESS_KEY, RUSTFS_SECRET_KEY)", () => {
      const c = config({ accessKey: "AK1", secretKey: "SK1" });
      expect(c.env.RUSTFS_ACCESS_KEY).toBe("AK1");
      expect(c.env.RUSTFS_SECRET_KEY).toBe("SK1");
    });

    it("honours overrides for image / region / port", () => {
      const c = config({ image: "rustfs/rustfs:edge", region: "eu-central-1", exposedPort: 9999 });
      expect(c.image).toBe("rustfs/rustfs:edge");
      expect(c.region).toBe("eu-central-1");
      expect(c.exposedPort).toBe(9999);
    });

    it("rejects an empty access-key (footgun guard)", () => {
      expect(() => buildRustFsContainerConfig({ accessKey: "" })).toThrow(/accessKey/i);
    });

    it("rejects an empty secret-key", () => {
      expect(() => buildRustFsContainerConfig({ secretKey: "" })).toThrow(/secretKey/i);
    });

    it("returns a fresh object every call (no shared mutation)", () => {
      const a = config();
      const b = config();
      expect(a).not.toBe(b);
      expect(a.env).not.toBe(b.env);
    });
  });
});
