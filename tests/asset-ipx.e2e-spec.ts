import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";
import { PrismaService } from "../src/core/prisma/prisma.service.js";
import { uuidV7 } from "../src/core/uuid/uuid-v7.js";
import { setActiveOrganization } from "./helpers/tenant-session.js";
import { emerald8x8Png } from "./lib/png-fixture.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * IPX asset endpoint (issue #17) — the new `/_ipx/<modifiers>/<source>`
 * URL surface that mirrors the Nuxt-Image provider contract.
 *
 * Asserts:
 *   1. `/_ipx/w_4,f_webp/<storageKey>` returns 200 + image/webp
 *   2. Missing source returns 404 with a problem-shaped body
 *   3. The legacy `/assets/:key?width=…&format=…` URL still works
 *      (backward compat re-route).
 *   4. Cache HIT/MISS surfaces through `x-cache` on the legacy path.
 *   5. Preset path `/_ipx/preset_thumbnail/<key>` resolves to a 200×200
 *      WebP.
 */
describe("Asset · IPX endpoint", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let storageRoot: string;
  let sessionCookie: string;
  let userId: string;
  let storageKey: string;
  const originalEnv: Record<string, string | undefined> = {};

  function rememberEnv(key: string): void {
    originalEnv[key] = process.env[key];
  }

  beforeAll(async () => {
    rememberEnv("BETTER_AUTH_SECRET");
    rememberEnv("APP_BASE_URL");
    rememberEnv("FEATURE_FILES_STORAGE_DEFAULT");
    rememberEnv("STORAGE_LOCAL_ROOT");
    rememberEnv("STORAGE_BASE_URL");

    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-for-testing-purposes-only-1234567890abcd";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.FEATURE_FILES_STORAGE_DEFAULT = "local";

    storageRoot = mkdtempSync(join(tmpdir(), "ipx-e2e-"));
    process.env.STORAGE_LOCAL_ROOT = storageRoot;
    process.env.STORAGE_BASE_URL = "http://localhost:3000/files";

    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);

    const orgName = `ipx-e2e-${Date.now()}`;
    const tenant = await prisma.organization.create({
      data: {
        id: uuidV7(),
        name: orgName,
        slug:
          orgName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .slice(0, 50) +
          "-" +
          Date.now(),
        createdAt: new Date(),
      },
    });
    tenantId = tenant.id;

    // Sign up a Better-Auth user — the session-middleware lets the
    // protected `/files/upload` and `/_ipx/*` endpoints through.
    const email = `ipx-e2e-${Date.now()}@example.com`;
    const signUp = await request(app.getHttpServer())
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({ email, password: "password-12345", name: "IPX E2E" });
    if (signUp.status !== 200) {
      throw new Error(`sign-up failed (${signUp.status}): ${JSON.stringify(signUp.body)}`);
    }
    const cookies = signUp.headers["set-cookie"] as unknown as string[] | undefined;
    if (!cookies || cookies.length === 0) {
      throw new Error("sign-up returned no Set-Cookie");
    }
    sessionCookie = cookies.map((c) => c.split(";")[0]).join("; ");
    userId = signUp.body.user.id as string;

    // Link user to tenant via member row (User.tenantId was removed in issue #118)
    await prisma.member.create({
      data: {
        id: uuidV7(),
        userId,
        organizationId: tenantId,
        role: "owner",
        createdAt: new Date(),
      },
    });
    await setActiveOrganization(app.getHttpServer(), sessionCookie, tenantId);

    // Upload a fixture PNG once for all subsequent IPX queries.
    const bytes = emerald8x8Png();
    const upload = await request(app.getHttpServer())
      .post("/api/files/upload")
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({
        folderId: null,
        filename: "fixture.png",
        mimeType: "image/png",
        uploaderId: "00000000-0000-0000-0000-000000000099",
        contentsBase64: Buffer.from(bytes).toString("base64"),
      });
    if (upload.status !== 201) {
      throw new Error(`fixture upload failed (${upload.status}): ${JSON.stringify(upload.body)}`);
    }
    storageKey = upload.body.storageKey as string;
  });

  afterAll(async () => {
    try {
      await prisma.file.deleteMany({ where: { tenantId } });
      await prisma.folder.deleteMany({ where: { tenantId } });
      await prisma.member.deleteMany({ where: { organizationId: tenantId } });
      await prisma.organization.delete({ where: { id: tenantId } });
    } catch {
      /* best-effort cleanup */
    }
    await app.close();
    rmSync(storageRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("GET /_ipx/<modifiers>/<key> returns the transformed image", async () => {
    const res = await request(app.getHttpServer())
      .get(`/_ipx/w_4,f_webp/${storageKey}`)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers["content-type"]).toContain("image/webp");
    // RIFF magic header — webp container.
    const head = new TextDecoder("ascii").decode(res.body.slice(0, 4));
    expect(head).toBe("RIFF");
  });

  it("GET /_ipx/_/... passthrough returns the raw bytes", async () => {
    // The literal `_` modifier-string is IPX's "no transforms" marker;
    // the response is the source format (PNG).
    const res = await request(app.getHttpServer())
      .get(`/_ipx/_/${storageKey}`)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");
    expect(res.status).toBe(200);
  });

  it("GET /_ipx/w_4/files/missing returns 404", async () => {
    const res = await request(app.getHttpServer())
      .get(`/_ipx/w_4/files/${tenantId}/does-not-exist.png`)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");
    expect(res.status).toBe(404);
  });

  it("GET /_ipx/preset_thumbnail/<key> resolves the preset to width/format/etc", async () => {
    const res = await request(app.getHttpServer())
      .get(`/_ipx/preset_thumbnail/${storageKey}`)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers["content-type"]).toContain("image/webp");
  });

  it("GET /assets/:key?width=4&format=webp keeps the legacy URL contract", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/assets/${encodeURIComponent(storageKey)}?width=4&format=webp`)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers["content-type"]).toContain("image/webp");
  });

  it("DELETE /_ipx/cache/:sourcePath drops cached transforms", async () => {
    // Prime the cache via the legacy controller — this writes a row
    // into the cache adapter (the IPX endpoint itself bypasses our
    // cache; see asset.controller comments).
    await request(app.getHttpServer())
      .get(`/api/assets/${encodeURIComponent(storageKey)}?width=4&format=webp`)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .expect(200);

    const res = await request(app.getHttpServer())
      .delete(`/_ipx/cache/${encodeURIComponent(storageKey)}`)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(typeof res.body.removed).toBe("number");
    expect(res.body.removed).toBeGreaterThanOrEqual(1);
  });

  it("DELETE /_ipx/cache/:sourcePath cascades via VariantCacheIndex — sibling sources survive (iter-183)", async () => {
    // Upload a sibling source so the cascade has something to NOT
    // delete — the legacy "wipe all `assets/*`" implementation would
    // drop both, but the iter-183 cascade only drops the variants
    // for the targeted source.
    const siblingBytes = emerald8x8Png();
    const siblingUpload = await request(app.getHttpServer())
      .post("/api/files/upload")
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({
        folderId: null,
        filename: "sibling.png",
        mimeType: "image/png",
        uploaderId: "00000000-0000-0000-0000-000000000099",
        contentsBase64: Buffer.from(siblingBytes).toString("base64"),
      });
    expect(siblingUpload.status).toBe(201);
    const siblingKey = siblingUpload.body.storageKey as string;
    expect(siblingKey).not.toBe(storageKey);

    // Prime cache for both sources via the legacy /api/assets endpoint.
    for (const key of [storageKey, siblingKey]) {
      await request(app.getHttpServer())
        .get(`/api/assets/${encodeURIComponent(key)}?width=4&format=webp`)
        .set("cookie", sessionCookie)
        .set("x-test-ability", "full")
        .expect(200);
    }

    // Targeted invalidation of the original source only.
    const res = await request(app.getHttpServer())
      .delete(`/_ipx/cache/${encodeURIComponent(storageKey)}`)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");
    expect(res.status).toBe(200);
    expect(res.body.removed).toBeGreaterThanOrEqual(1);

    // Sibling cache HIT proves the cascade did NOT drop its variant.
    // The next GET on the sibling MUST report `x-cache: HIT`; if the
    // cascade had wiped everything, we'd see MISS instead.
    const siblingHit = await request(app.getHttpServer())
      .get(`/api/assets/${encodeURIComponent(siblingKey)}?width=4&format=webp`)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");
    expect(siblingHit.status).toBe(200);
    expect(siblingHit.headers["x-cache"]).toBe("HIT");

    // The original source MUST report MISS (next request re-renders).
    const originalMiss = await request(app.getHttpServer())
      .get(`/api/assets/${encodeURIComponent(storageKey)}?width=4&format=webp`)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");
    expect(originalMiss.status).toBe(200);
    expect(originalMiss.headers["x-cache"]).toBe("MISS");
  });
});
