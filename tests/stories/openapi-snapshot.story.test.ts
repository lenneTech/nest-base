import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../../src/core/app/bootstrap.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * Story · Offline OpenAPI snapshot.
 *
 * Friction (2026-05-03 14:36): a frontend agent who couldn't boot the
 * dev runner had no way to generate `app/api-client/types.gen.ts`,
 * because `openapi-ts.config.ts` only knows how to fetch the spec from
 * a live API. The fallback was hand-writing TypeScript interfaces —
 * exactly what the "generated only" rule forbids.
 *
 * Fix: commit a snapshot of the document at `docs/openapi.snapshot.json`
 * so a frontend agent can target the file directly when the API is
 * down. The snapshot ships with the repo and is kept fresh by
 * `bun run dump:openapi`.
 *
 * This story pins:
 *   1. The snapshot file exists at the conventional path.
 *   2. The snapshot's body matches what bootstrap() emits at runtime.
 *      If a `src/core/` change adds / removes / renames a route or a
 *      Zod-derived schema, the snapshot drifts and CI fails — at which
 *      point the contributor regenerates it via `bun run dump:openapi`
 *      and re-stages the file.
 *   3. The snapshot has the OpenAPI 3.x marker so consumers can sanity-
 *      check the file without re-parsing it.
 */
const SNAPSHOT_PATH = resolve(process.cwd(), "docs/openapi.snapshot.json");

describe("Story · Offline OpenAPI snapshot (docs/openapi.snapshot.json)", () => {
  let app: INestApplication;
  let liveDocument: Record<string, unknown>;

  beforeAll(async () => {
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    const res = await request(app.getHttpServer()).get("/api/openapi.json");
    expect(res.status).toBe(200);
    liveDocument = res.body;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("the snapshot file exists at docs/openapi.snapshot.json", () => {
    expect(
      existsSync(SNAPSHOT_PATH),
      `Missing ${SNAPSHOT_PATH}. Run \`bun run dump:openapi\` to (re)generate it.`,
    ).toBe(true);
  });

  it("is valid JSON and carries the OpenAPI 3.x marker", () => {
    const raw = readFileSync(SNAPSHOT_PATH, "utf8");
    const parsed = JSON.parse(raw) as { openapi?: string };
    expect(typeof parsed.openapi).toBe("string");
    expect(parsed.openapi!).toMatch(/^3\./);
  });

  it("matches the document bootstrap() emits at runtime (regenerate via `bun run dump:openapi` on drift)", () => {
    const raw = readFileSync(SNAPSHOT_PATH, "utf8");
    const snapshot = JSON.parse(raw);
    // Deep equality on the structural body. Drift surfaces as a clear
    // diff — the failure message tells the contributor exactly what
    // command to run. We compare via JSON serialisation to dodge
    // property-ordering noise (`expect(...).toEqual(...)` already
    // handles that, but the explicit `JSON.stringify` round-trip
    // guarantees the on-disk file stays byte-stable across formatters).
    const liveStable = JSON.parse(JSON.stringify(liveDocument));
    expect(snapshot).toEqual(liveStable);
  });
});
