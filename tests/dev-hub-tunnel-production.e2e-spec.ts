import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";
import { tunnelStateLockPath } from "../src/core/dev/tunnel-state-runner.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * `GET /dev/tunnel.json` — production gate.
 *
 * Lives in its own file (split from `dev-hub-tunnel.e2e-spec.ts` in
 * iter-146) so the file's worker fork boots ONE Nest app with
 * `NODE_ENV=production` set before module evaluation. Co-locating
 * a development-mode app and a production-mode app in the same
 * worker process surfaced a transient parallel-execution flake
 * (iter-144) — the second-app boot races against the first app's
 * teardown and bootstrap-time env reads land on stale values. One
 * NODE_ENV per file is the durable fix.
 */
describe("Dev-Hub · GET /dev/tunnel.json — production gate", () => {
  let app: INestApplication;
  let previousNodeEnv: string | undefined;
  let previousLockPath: string | undefined;
  let workerCacheDir: string | undefined;

  beforeAll(async () => {
    // Per-worker temp lock-file path so this file's tunnel-state
    // mutations don't race with `dev-hub-tunnel.e2e-spec.ts` which
    // runs in a sibling worker process and resolves the same
    // project-root-relative lock-file path. iter-146 surfaced the
    // cross-file file-system contention; the env override added to
    // `tunnelStateLockPath` is the durable fix.
    workerCacheDir = mkdtempSync(join(tmpdir(), "dev-hub-tunnel-prod-cache-"));
    previousLockPath = process.env.TUNNEL_STATE_LOCK_PATH;
    process.env.TUNNEL_STATE_LOCK_PATH = join(workerCacheDir, "tunnel.json");

    // Provide the env vars production bootstrap requires so the env
    // pre-check passes; we only care that the controller short-circuits
    // production traffic to a 404.
    previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.APP_BASE_URL = "https://example.com";
    process.env.SECRET_KEK_HEX = "0".repeat(64);
    process.env.SECRET_HMAC_HEX = "0".repeat(64);
    process.env.BETTER_AUTH_SECRET = "0".repeat(64);
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
  });

  afterAll(async () => {
    await app.close();
    delete process.env.APP_BASE_URL;
    delete process.env.SECRET_KEK_HEX;
    delete process.env.SECRET_HMAC_HEX;
    delete process.env.BETTER_AUTH_SECRET;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousLockPath === undefined) delete process.env.TUNNEL_STATE_LOCK_PATH;
    else process.env.TUNNEL_STATE_LOCK_PATH = previousLockPath;
    if (workerCacheDir) rmSync(workerCacheDir, { recursive: true, force: true });
  });

  it("404s in production even when the state file exists", async () => {
    const path = tunnelStateLockPath(process.cwd());
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        url: "https://leaked.trycloudflare.com",
        startedAt: "2026-04-30T10:00:00.000Z",
      }),
      "utf8",
    );
    try {
      const res = await request(app.getHttpServer()).get("/dev/tunnel.json");
      expect(res.status).toBe(404);
    } finally {
      rmSync(path, { force: true });
    }
  });
});
