import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

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

  beforeAll(async () => {
    previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
  });

  afterAll(async () => {
    await app.close();
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
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

describe("Dev-Hub · GET /dev/tunnel.json — production gate", () => {
  let app: INestApplication;
  let previousNodeEnv: string | undefined;

  beforeAll(async () => {
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

describe("Dev-Hub · /dev/tunnel.json — controller declaration smoke check", () => {
  it("dev-hub.controller.ts declares @Get('tunnel.json')", () => {
    const text = require("node:fs").readFileSync(
      resolve(import.meta.dirname, "..", "src", "core", "dx", "dev-hub.controller.ts"),
      "utf8",
    );
    expect(text).toMatch(/@Get\("tunnel\.json"\)/);
  });
});
