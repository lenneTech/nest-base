import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
 *   2. The snapshot has the OpenAPI 3.x marker so consumers can sanity-
 *      check the file without re-parsing it.
 *   3. The snapshot's body matches what bootstrap() emits inside this
 *      same vitest worker. If a `src/core/` change adds / removes a
 *      route or a Zod-derived schema, the snapshot drifts and CI fails
 *      — at which point the contributor regenerates it via
 *      `bun run dump:openapi` and re-stages the file.
 *
 * Note: the snapshot is the authoritative artefact for frontend
 * consumers, who target it via `openapi-ts --input
 * docs/openapi.snapshot.json`. Both the dump script and this test
 * boot through the same `bootstrap()` entry point so they observe
 * identical decorator metadata.
 */
const SNAPSHOT_PATH = resolve(process.cwd(), "docs/openapi.snapshot.json");

/**
 * Pretty-print + trailing newline. Mirrors the format `scripts/dump-openapi.ts`
 * writes — both must serialise the same way for the byte-equality
 * check to hold.
 */
function stableSerialize(document: unknown): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

describe("Story · Offline OpenAPI snapshot (docs/openapi.snapshot.json)", () => {
  let app: INestApplication;
  let liveDocument: Record<string, unknown>;

  beforeAll(async () => {
    // `listen: false` keeps this test from binding to port 3000 so it
    // never conflicts with a running dev server. If you see an intermittent
    // native abort here it is almost always a Prisma native binary clash
    // from another parallel worker that also called bootstrap() — not a
    // port conflict. The `afterAll` below calls `app.close()` which tears
    // down Prisma cleanly, so the next run is always clean.
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    const res = await request(app.getHttpServer()).get("/api/openapi.json");
    expect(res.status).toBe(200);
    liveDocument = res.body;

    // Self-update mode: write the snapshot when UPDATE_OPENAPI_SNAPSHOT=1
    // is set. This is how `bun run dump:openapi` populates the file —
    // the script invokes vitest with this env on, which boots through
    // the same transform pipeline the assertions below use, so the
    // committed snapshot can never diverge from "what the test would
    // accept". Without this flag the test stays a pure verifier.
    if (process.env.UPDATE_OPENAPI_SNAPSHOT === "1") {
      writeFileSync(SNAPSHOT_PATH, stableSerialize(liveDocument), "utf8");
    }
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
    const liveStable = JSON.parse(JSON.stringify(liveDocument));
    expect(snapshot).toEqual(liveStable);
  });
});
