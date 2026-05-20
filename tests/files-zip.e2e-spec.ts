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
 * Files · bulk-zip download (e2e). Validates the
 * POST `/files/zip` surface introduced in iter-114 (CF.FILES.06).
 */
describe("Files · bulk-zip download", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let fileIdA: string;
  let fileIdB: string;
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
    storageRoot = mkdtempSync(join(tmpdir(), "files-zip-e2e-"));
    process.env.STORAGE_LOCAL_ROOT = storageRoot;
    process.env.STORAGE_BASE_URL = "http://localhost:3000/files";

    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);

    const orgName = `zip-${Date.now()}`;
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

    const email = `zip-e2e-${Date.now()}@example.com`;
    const signUp = await request(app.getHttpServer())
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({ email, password: "password-12345", name: "Zip E2E" });
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

    async function uploadOne(name: string, payload: Uint8Array, mime: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/api/files/upload")
        .set("cookie", sessionCookie)
        .set("x-test-ability", "full")
        .send({
          tenantId,
          folderId: null,
          filename: name,
          mimeType: mime,
          uploaderId: "00000000-0000-0000-0000-000000000099",
          contentsBase64: Buffer.from(payload).toString("base64"),
        });
      if (res.status !== 201 && res.status !== 200) {
        throw new Error(`upload failed (${res.status}): ${JSON.stringify(res.body)}`);
      }
      return res.body.id as string;
    }

    fileIdA = await uploadOne("alpha.txt", new TextEncoder().encode("alpha-bytes"), "text/plain");
    fileIdB = await uploadOne("beta.png", emerald8x8Png(), "image/png");
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

  it("POST /files/zip streams an application/zip body containing both files", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/files/zip")
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .set("accept", "application/zip")
      .send({ ids: [fileIdA, fileIdB] })
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (c: Buffer) => chunks.push(c));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/zip");
    expect(res.headers["content-disposition"]).toContain('filename="files.zip"');
    const body = res.body as Buffer;
    // PKZIP local-file-header signature 0x04034b50 little-endian.
    expect(body.readUInt32LE(0)).toBe(0x04034b50);
    // EOCD signature 0x06054b50 lives at body.length - 22.
    expect(body.readUInt32LE(body.length - 22)).toBe(0x06054b50);
    // Total entries field at EOCD+10 should be 2.
    expect(body.readUInt16LE(body.length - 22 + 10)).toBe(2);
    // The body should contain the filename literals (UTF-8) — the
    // STORED-mode archive emits filenames in plaintext at the LFH.
    expect(body.includes(Buffer.from("alpha.txt"))).toBe(true);
    expect(body.includes(Buffer.from("beta.png"))).toBe(true);
    // Bytes of "alpha.txt" survived round-trip.
    expect(body.includes(Buffer.from("alpha-bytes"))).toBe(true);
  });

  it("rejects an empty id list with 400", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/files/zip")
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({ ids: [] });
    expect(res.status).toBe(400);
  });

  it("returns 404 if any id is not found", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/files/zip")
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({ ids: [fileIdA, "00000000-0000-0000-0000-000000000999"] });
    expect(res.status).toBe(404);
  });
});
