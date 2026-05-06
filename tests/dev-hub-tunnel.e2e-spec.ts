import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";
import { tunnelStateLockPath } from "../src/core/dev/tunnel-state-runner.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * `GET /dev/tunnel.json` — exposes the active Cloudflare-Tunnel URL
 * the dev runner discovered. The endpoint reads the `tunnel.json`
 * lock file in `node_modules/.cache/nest-base/`. When the file is
 * absent, the endpoint reports `{ active: false }`.
 *
 * The endpoint 404s outside `NODE_ENV=development` so a stale lock
 * file in production never leaks a public URL.
 */
describe("Dev-Hub · GET /dev/tunnel.json", () => {
  let app: INestApplication;
  let previousNodeEnv: string | undefined;
  let previousLockPath: string | undefined;
  let workerCacheDir: string | undefined;

  beforeAll(async () => {
    // Per-worker temp lock-file path so this file's tunnel-state
    // mutations don't race with `dev-hub-tunnel-production.e2e-spec.ts`
    // which runs in a sibling worker process and resolves the same
    // project-root-relative lock-file path. iter-146 surfaced the
    // cross-file file-system contention; the env override added to
    // `tunnelStateLockPath` is the durable fix.
    workerCacheDir = mkdtempSync(join(tmpdir(), "dev-hub-tunnel-cache-"));
    previousLockPath = process.env.TUNNEL_STATE_LOCK_PATH;
    process.env.TUNNEL_STATE_LOCK_PATH = join(workerCacheDir, "tunnel.json");

    previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
  });

  afterAll(async () => {
    await app.close();
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousLockPath === undefined) delete process.env.TUNNEL_STATE_LOCK_PATH;
    else process.env.TUNNEL_STATE_LOCK_PATH = previousLockPath;
    if (workerCacheDir) rmSync(workerCacheDir, { recursive: true, force: true });
  });

  afterEach(() => {
    // Clean any state file left over so the next test starts fresh.
    const path = tunnelStateLockPath(process.cwd());
    try {
      rmSync(path, { force: true });
    } catch {
      /* ignore */
    }
  });

  it("returns active=false when no tunnel state file exists", async () => {
    const res = await request(app.getHttpServer()).get("/dev/tunnel.json");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ active: false });
  });

  it("returns the tunnel URL + startedAt when the runner has written the state file", async () => {
    const path = tunnelStateLockPath(process.cwd());
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        url: "https://example-cute-name-123.trycloudflare.com",
        startedAt: "2026-04-30T10:00:00.000Z",
      }),
      "utf8",
    );
    const res = await request(app.getHttpServer()).get("/dev/tunnel.json");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      active: true,
      url: "https://example-cute-name-123.trycloudflare.com",
      startedAt: "2026-04-30T10:00:00.000Z",
    });
  });

  it("returns active=false when the state file is corrupted (defense-in-depth)", async () => {
    const path = tunnelStateLockPath(process.cwd());
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not-valid-json", "utf8");
    const res = await request(app.getHttpServer()).get("/dev/tunnel.json");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ active: false });
  });
});

// The production-gate test moved to dev-hub-tunnel-production.e2e-spec.ts
// in iter-146 to avoid a transient parallel-execution race against the
// development-mode app in this file (iter-144 surfaced the flake; the
// fix is one NODE_ENV per worker fork). Both files share the same
// controller code; the split is purely about test isolation.

describe("Dev-Hub · /dev/tunnel.json — controller declaration smoke check", () => {
  it("dev-hub.controller.ts declares @Get('tunnel.json')", () => {
    const text = require("node:fs").readFileSync(
      resolve(import.meta.dirname, "..", "src", "core", "dx", "dev-hub.controller.ts"),
      "utf8",
    );
    expect(text).toMatch(/@Get\("tunnel\.json"\)/);
  });
});
