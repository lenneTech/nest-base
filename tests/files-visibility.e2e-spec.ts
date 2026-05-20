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
 * Files · visibility toggle (e2e). Validates the
 * PATCH `/files/:id/visibility` surface introduced in iter-113
 * (CF.FILES.06).
 */
describe("Files · visibility toggle", () => {
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

    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-for-testing-purposes-only-1234567890abcd";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.FEATURE_FILES_STORAGE_DEFAULT = "local";
    storageRoot = mkdtempSync(join(tmpdir(), "files-vis-e2e-"));
    process.env.STORAGE_LOCAL_ROOT = storageRoot;
    process.env.STORAGE_BASE_URL = "http://localhost:3000/files";

    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);

    const orgName = `vis-${Date.now()}`;
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

    const email = `vis-e2e-${Date.now()}@example.com`;
    const signUp = await request(app.getHttpServer())
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({ email, password: "password-12345", name: "Vis E2E" });
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

    const bytes = emerald8x8Png();
    const upload = await request(app.getHttpServer())
      .post("/api/files/upload")
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({
        tenantId,
        folderId: null,
        filename: "vis-test.png",
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
      await prisma.member.deleteMany({ where: { organizationId: tenantId } });
      await prisma.organization.delete({ where: { id: tenantId } });
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

  it("uploads default to PRIVATE visibility", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/files/${fileId}`)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");
    expect(res.status).toBe(200);
    expect(res.body.visibility).toBe("PRIVATE");
  });

  it("PATCH /files/:id/visibility flips PRIVATE → PUBLIC", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/files/${fileId}/visibility`)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({ visibility: "PUBLIC" });
    expect(res.status).toBe(200);
    expect(res.body.visibility).toBe("PUBLIC");

    const after = await request(app.getHttpServer())
      .get(`/api/files/${fileId}`)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");
    expect(after.body.visibility).toBe("PUBLIC");
  });

  it("rejects an unknown visibility value with 400", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/files/${fileId}/visibility`)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({ visibility: "WORLD" });
    expect(res.status).toBe(400);
  });

  it("PATCH on an unknown file id returns 404", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/files/00000000-0000-0000-0000-000000000999/visibility`)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({ visibility: "PUBLIC" });
    expect(res.status).toBe(404);
  });
});
