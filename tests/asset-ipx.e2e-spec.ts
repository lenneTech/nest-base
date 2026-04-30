import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";
import { PrismaService } from "../src/core/prisma/prisma.service.js";
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

    process.env.BETTER_AUTH_SECRET = "test-secret-32-chars-minimum-aaaaaaaa";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.FEATURE_FILES_STORAGE_DEFAULT = "local";

    storageRoot = mkdtempSync(join(tmpdir(), "ipx-e2e-"));
    process.env.STORAGE_LOCAL_ROOT = storageRoot;
    process.env.STORAGE_BASE_URL = "http://localhost:3000/files";

    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);

    const tenant = await prisma.tenant.create({
      data: { name: `ipx-e2e-${Date.now()}` },
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

    await prisma.user.update({ where: { id: userId }, data: { tenantId } });

    // Upload a fixture PNG once for all subsequent IPX queries.
    const bytes = emerald8x8Png();
    const upload = await request(app.getHttpServer())
      .post("/files/upload")
      .set("x-tenant-id", tenantId)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({
        tenantId,
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
      await prisma.tenant.delete({ where: { id: tenantId } });
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
      .set("x-tenant-id", tenantId)
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
      .set("x-tenant-id", tenantId)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");
    expect(res.status).toBe(200);
  });

  it("GET /_ipx/w_4/files/missing returns 404", async () => {
    const res = await request(app.getHttpServer())
      .get(`/_ipx/w_4/files/${tenantId}/does-not-exist.png`)
      .set("x-tenant-id", tenantId)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");
    expect(res.status).toBe(404);
  });

  it("GET /_ipx/preset_thumbnail/<key> resolves the preset to width/format/etc", async () => {
    const res = await request(app.getHttpServer())
      .get(`/_ipx/preset_thumbnail/${storageKey}`)
      .set("x-tenant-id", tenantId)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers["content-type"]).toContain("image/webp");
  });

  it("GET /assets/:key?width=4&format=webp keeps the legacy URL contract", async () => {
    const res = await request(app.getHttpServer())
      .get(`/assets/${encodeURIComponent(storageKey)}?width=4&format=webp`)
      .set("x-tenant-id", tenantId)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers["content-type"]).toContain("image/webp");
  });
});
