import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";
import { PrismaService } from "../src/core/prisma/prisma.service.js";
import { signShareLink } from "../src/core/files/share-link.js";
import { emerald8x8Png } from "./lib/png-fixture.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * Files · share-link round-trip (e2e). Validates the new
 * `/files/:id/share-link` issuance + `/files/share/:token` resolve
 * surface introduced in iter-112 (CF.FILES.06).
 */
describe("Files · share-link round-trip", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let fileId: string;
  let storageRoot: string;
  let sessionCookie: string;
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
    rememberEnv("FILE_SHARE_LINK_SECRET");

    process.env.BETTER_AUTH_SECRET = "test-secret-32-chars-minimum-aaaaaaaa";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.FEATURE_FILES_STORAGE_DEFAULT = "local";
    process.env.FILE_SHARE_LINK_SECRET = "iter-112-share-link-secret";
    storageRoot = mkdtempSync(join(tmpdir(), "files-share-e2e-"));
    process.env.STORAGE_LOCAL_ROOT = storageRoot;
    process.env.STORAGE_BASE_URL = "http://localhost:3000/files";

    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);

    const tenant = await prisma.tenant.create({ data: { name: `share-${Date.now()}` } });
    tenantId = tenant.id;

    const email = `share-e2e-${Date.now()}@example.com`;
    const signUp = await request(app.getHttpServer())
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({ email, password: "password-12345", name: "Share E2E" });
    if (signUp.status !== 200) {
      throw new Error(`sign-up failed (${signUp.status}): ${JSON.stringify(signUp.body)}`);
    }
    const setCookie = signUp.headers["set-cookie"];
    const cookies: string[] | undefined = Array.isArray(setCookie)
      ? (setCookie as string[])
      : typeof setCookie === "string"
        ? [setCookie]
        : undefined;
    sessionCookie = (cookies ?? []).map((c) => c.split(";")[0]).join("; ");
    const userId = signUp.body.user.id as string;
    await prisma.user.update({ where: { id: userId }, data: { tenantId } });

    const bytes = emerald8x8Png();
    const upload = await request(app.getHttpServer())
      .post("/api/files/upload")
      .set("x-tenant-id", tenantId)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({
        tenantId,
        folderId: null,
        filename: "shared.png",
        mimeType: "image/png",
        uploaderId: "00000000-0000-0000-0000-000000000099",
        contentsBase64: Buffer.from(bytes).toString("base64"),
      });
    if (upload.status !== 201 && upload.status !== 200) {
      throw new Error(`upload failed (${upload.status}): ${JSON.stringify(upload.body)}`);
    }
    fileId = upload.body.id as string;
  });

  afterAll(async () => {
    try {
      await prisma.file.deleteMany({ where: { tenantId } });
      await prisma.folder.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    } catch {
      // best-effort
    }
    await app.close();
    rmSync(storageRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("POST /files/:id/share-link issues a token + URL + ISO expiry", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/files/${fileId}/share-link`)
      .set("x-tenant-id", tenantId)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({ ttlSeconds: 3600 });
    expect(res.status).toBe(201);
    expect(typeof res.body.shareToken).toBe("string");
    expect(res.body.shareToken.split(".")).toHaveLength(4);
    expect(res.body.url).toBe(`/api/files/share/${res.body.shareToken}`);
    expect(typeof res.body.expiresAt).toBe("string");
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("GET /files/share/:token resolves the file metadata without auth", async () => {
    const issue = await request(app.getHttpServer())
      .post(`/api/files/${fileId}/share-link`)
      .set("x-tenant-id", tenantId)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({ ttlSeconds: 3600 });
    expect(issue.status).toBe(201);

    // No cookie, no x-tenant-id — the share token is the auth.
    const fetch = await request(app.getHttpServer()).get(`/api/files/share/${issue.body.shareToken}`);
    expect(fetch.status).toBe(200);
    expect(fetch.body.id).toBe(fileId);
    expect(fetch.body.filename).toBe("shared.png");
  });

  it("rejects an expired token with 404", async () => {
    const expiredToken = signShareLink({
      fileId,
      tenantId,
      expiresAtMs: Date.now() - 60_000,
      secret: "iter-112-share-link-secret",
    });
    const res = await request(app.getHttpServer()).get(`/api/files/share/${expiredToken}`);
    expect(res.status).toBe(404);
  });

  it("rejects a tampered token with 400", async () => {
    const valid = signShareLink({
      fileId,
      tenantId,
      expiresAtMs: Date.now() + 60_000,
      secret: "iter-112-share-link-secret",
    });
    const parts = valid.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    const res = await request(app.getHttpServer()).get(`/api/files/share/${tampered}`);
    expect(res.status).toBe(400);
  });
});
