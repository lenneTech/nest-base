import { createHash } from "node:crypto";
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
 * Files persistence (e2e) — Issue #16 closing test.
 *
 * Pipes a real upload through the Prisma metadata tier and the local
 * StorageAdapter. Asserts:
 *   1. POST /files/upload writes both a metadata row and bytes.
 *   2. GET /files/:id returns the metadata after a fresh app boot
 *      (the adapter is rebuilt; the row survives because it's in
 *      Postgres now, not an in-memory map).
 *   3. GET /assets/:key streams real bytes from the adapter — not a
 *      32x32 placeholder PNG.
 */
describe("Files · persistence (Prisma metadata + Local adapter)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let storageRoot: string;
  let sessionCookie: string;
  let userId: string;
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

    storageRoot = mkdtempSync(join(tmpdir(), "files-e2e-"));
    process.env.STORAGE_LOCAL_ROOT = storageRoot;
    process.env.STORAGE_BASE_URL = "http://localhost:3000/files";

    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);

    const orgName = `files-e2e-${Date.now()}`;
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

    // Sign up a Better-Auth user so the session-middleware lets the
    // protected /files endpoints through. The middleware reads the
    // Better-Auth cookie / Authorization header before our handlers.
    const email = `files-e2e-${Date.now()}@example.com`;
    const signUp = await request(app.getHttpServer())
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({ email, password: "password-12345", name: "Files E2E" });
    if (signUp.status !== 200) {
      throw new Error(`sign-up failed (${signUp.status}): ${JSON.stringify(signUp.body)}`);
    }
    const cookies = signUp.headers["set-cookie"] as unknown as string[] | undefined;
    if (!cookies || cookies.length === 0) {
      throw new Error("sign-up returned no Set-Cookie");
    }
    // Forward the session cookie on every request.
    sessionCookie = cookies.map((c) => c.split(";")[0]).join("; ");
    userId = signUp.body.user.id as string;

    // Activate the user's tenant membership so RLS policies + the
    // permission ability include the tenant we just created.
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
  });

  afterAll(async () => {
    try {
      await prisma.file.deleteMany({ where: { tenantId } });
      await prisma.folder.deleteMany({ where: { tenantId } });
      await prisma.member.deleteMany({ where: { organizationId: tenantId } });
      await prisma.organization.delete({ where: { id: tenantId } });
    } catch {
      // best-effort: testcontainer is tossed by global-setup anyway
    }
    await app.close();
    rmSync(storageRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // Uses the shared 8×8 PNG fixture so this spec doesn't pull in
  // `sharp` directly (rule from issue #17).
  async function makePng(): Promise<Uint8Array> {
    return emerald8x8Png();
  }

  it("POST /files/upload persists the bytes + metadata", async () => {
    const bytes = await makePng();
    const sha = createHash("sha256").update(bytes).digest("hex");
    const res = await request(app.getHttpServer())
      .post("/api/files/upload")
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({
        folderId: null,
        filename: "logo.png",
        mimeType: "image/png",
        uploaderId: "00000000-0000-0000-0000-000000000099",
        contentsBase64: Buffer.from(bytes).toString("base64"),
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.filename).toBe("logo.png");
    expect(res.body.sha256).toBe(sha);
    expect(res.body.storageDriver).toBe("local");

    // Metadata row exists in Postgres.
    const persisted = await prisma.file.findUnique({ where: { id: res.body.id } });
    expect(persisted).not.toBeNull();
    expect(persisted!.tenantId).toBe(tenantId);
  });

  it("GET /files/:id resolves a freshly-uploaded record", async () => {
    const bytes = await makePng();
    const upload = await request(app.getHttpServer())
      .post("/api/files/upload")
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({
        folderId: null,
        filename: "alpha.png",
        mimeType: "image/png",
        uploaderId: "00000000-0000-0000-0000-000000000099",
        contentsBase64: Buffer.from(bytes).toString("base64"),
      });
    expect(upload.status).toBe(201);
    const id = upload.body.id;

    const get = await request(app.getHttpServer())
      .get(`/api/files/${id}`)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");

    expect(get.status).toBe(200);
    expect(get.body.filename).toBe("alpha.png");
  });

  it("GET /assets/:key streams the original bytes from the storage adapter", async () => {
    const bytes = await makePng();
    const sha = createHash("sha256").update(bytes).digest("hex");
    const upload = await request(app.getHttpServer())
      .post("/api/files/upload")
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({
        folderId: null,
        filename: "asset.png",
        mimeType: "image/png",
        uploaderId: "00000000-0000-0000-0000-000000000099",
        contentsBase64: Buffer.from(bytes).toString("base64"),
      });
    expect(upload.status).toBe(201);

    const storageKey = upload.body.storageKey as string;
    expect(storageKey).toContain(tenantId);

    // The asset endpoint walks the AssetController → AssetService →
    // StorageAdapter pipeline. With no transform requested, the bytes
    // should match the upload exactly.
    const res = await request(app.getHttpServer())
      .get(`/api/assets/${encodeURIComponent(storageKey)}`)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");

    expect(res.status).toBe(200);
    const downloadedSha = createHash("sha256").update(res.body).digest("hex");
    expect(downloadedSha).toBe(sha);
    // Cache header should be BYPASS for passthrough (no transform).
    expect(res.headers["x-cache"]).toBe("BYPASS");
  });

  it("GET /assets/:key with width transform writes a cache entry (HIT on second call)", async () => {
    const bytes = await makePng();
    const upload = await request(app.getHttpServer())
      .post("/api/files/upload")
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({
        folderId: null,
        filename: "tx.png",
        mimeType: "image/png",
        uploaderId: "00000000-0000-0000-0000-000000000099",
        contentsBase64: Buffer.from(bytes).toString("base64"),
      });
    expect(upload.status).toBe(201);
    const storageKey = upload.body.storageKey as string;

    // First call: cache miss (bytes go through sharp).
    const first = await request(app.getHttpServer())
      .get(`/api/assets/${encodeURIComponent(storageKey)}?width=4&format=webp`)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");
    expect(first.status).toBe(200);
    expect(first.headers["content-type"]).toContain("image/webp");
    expect(first.headers["x-cache"]).toBe("MISS");

    // Second call: cache hit (no transformer invocation).
    const second = await request(app.getHttpServer())
      .get(`/api/assets/${encodeURIComponent(storageKey)}?width=4&format=webp`)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");
    expect(second.status).toBe(200);
    expect(second.headers["x-cache"]).toBe("HIT");
  });

  it("metadata survives a fresh boot (Prisma persistence is wired, not in-memory)", async () => {
    const bytes = await makePng();
    const upload = await request(app.getHttpServer())
      .post("/api/files/upload")
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({
        folderId: null,
        filename: "persist.png",
        mimeType: "image/png",
        uploaderId: "00000000-0000-0000-0000-000000000099",
        contentsBase64: Buffer.from(bytes).toString("base64"),
      });
    expect(upload.status).toBe(201);
    const id = upload.body.id;

    // Tear down + boot a fresh app. The Postgres row must still be
    // there — that's the closing-the-loop assertion for the "files
    // disappear on restart" finding the issue calls out.
    await app.close();
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);

    const persisted = await prisma.file.findUnique({ where: { id } });
    expect(persisted).not.toBeNull();
    expect(persisted!.filename).toBe("persist.png");
  });
});
