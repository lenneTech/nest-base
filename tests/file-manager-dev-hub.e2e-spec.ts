import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";
import { PrismaService } from "../src/core/prisma/prisma.service.js";
import { uuidV7 } from "../src/core/uuid/uuid-v7.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * `/dev/files*` — JSON sidecars that drive the File-Manager React page
 * (issue #18).
 *
 * Surface contract:
 *   - GET /dev/files                   → SPA shell HTML
 *   - GET /dev/files/tree.json         → folder tree (root + children, recursive)
 *   - GET /dev/files/list.json         → files in a folder, with sort/filter
 *   - GET /dev/files/breadcrumb.json   → root-to-active path
 *
 * Every endpoint 404s outside `NODE_ENV=development`, identical to the
 * rest of the dev-hub.
 */
describe("Dev-Hub File-Manager · /dev/files*", () => {
  describe("in development mode", () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let tenantId: string;
    let previousNodeEnv: string | undefined;

    beforeAll(async () => {
      previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
      prisma = app.get(PrismaService);
      const orgName = `files-dev-hub-${Date.now()}`;
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
    });

    afterAll(async () => {
      try {
        await prisma.file.deleteMany({ where: { tenantId } });
        await prisma.folder.deleteMany({ where: { tenantId } });
        await prisma.organization.delete({ where: { id: tenantId } });
      } catch {
        // best-effort
      }
      await app.close();
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    });

    it("GET /dev/files returns the SPA shell HTML", async () => {
      const res = await request(app.getHttpServer()).get("/api/hub/files");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toContain('<div id="root"></div>');
    });

    it("GET /dev/files/tree.json returns an empty tree for an empty tenant", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/hub/files/tree.json")
        .set("x-tenant-id", tenantId);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(Array.isArray(res.body.tree)).toBe(true);
      expect(res.body.tree).toEqual([]);
    });

    it("GET /dev/files/tree.json returns the folder hierarchy after seeding", async () => {
      const root = await prisma.folder.create({
        data: { tenantId, parentId: null, name: "Customers" },
      });
      const child = await prisma.folder.create({
        data: { tenantId, parentId: root.id, name: "Acme" },
      });
      try {
        const res = await request(app.getHttpServer())
          .get("/api/hub/files/tree.json")
          .set("x-tenant-id", tenantId);
        expect(res.status).toBe(200);
        expect(res.body.tree).toHaveLength(1);
        expect(res.body.tree[0].name).toBe("Customers");
        expect(res.body.tree[0].children).toHaveLength(1);
        expect(res.body.tree[0].children[0].name).toBe("Acme");
      } finally {
        await prisma.folder.delete({ where: { id: child.id } });
        await prisma.folder.delete({ where: { id: root.id } });
      }
    });

    it("GET /dev/files/list.json returns files in the requested folder with metadata", async () => {
      const folder = await prisma.folder.create({
        data: { tenantId, parentId: null, name: "Reports" },
      });
      const fileRow = await prisma.file.create({
        data: {
          tenantId,
          folderId: folder.id,
          filename: "annual.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          sha256: "0".repeat(64),
          storageDriver: "local",
          storageKey: `${tenantId}/${folder.id}/annual.pdf`,
          uploaderId: "00000000-0000-0000-0000-000000000099",
        },
      });
      try {
        const res = await request(app.getHttpServer())
          .get(`/api/hub/files/list.json?folderId=${folder.id}`)
          .set("x-tenant-id", tenantId);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.files)).toBe(true);
        const matched = (
          res.body.files as Array<{ id: string; filename: string; thumbnailUrl?: string }>
        ).find((f) => f.id === fileRow.id);
        expect(matched).toBeDefined();
        expect(matched!.filename).toBe("annual.pdf");
        expect(typeof res.body.totalCount).toBe("number");
      } finally {
        await prisma.file.delete({ where: { id: fileRow.id } });
        await prisma.folder.delete({ where: { id: folder.id } });
      }
    });

    it("GET /dev/files/list.json filters by `search` substring", async () => {
      const folder = await prisma.folder.create({
        data: { tenantId, parentId: null, name: "Filter" },
      });
      const a = await prisma.file.create({
        data: {
          tenantId,
          folderId: folder.id,
          filename: "invoice.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1,
          sha256: "0".repeat(64),
          storageDriver: "local",
          storageKey: `${tenantId}/${folder.id}/invoice.pdf`,
          uploaderId: "00000000-0000-0000-0000-000000000099",
        },
      });
      const b = await prisma.file.create({
        data: {
          tenantId,
          folderId: folder.id,
          filename: "report.docx",
          mimeType: "application/msword",
          sizeBytes: 1,
          sha256: "0".repeat(64),
          storageDriver: "local",
          storageKey: `${tenantId}/${folder.id}/report.docx`,
          uploaderId: "00000000-0000-0000-0000-000000000099",
        },
      });
      try {
        const res = await request(app.getHttpServer())
          .get(`/api/hub/files/list.json?folderId=${folder.id}&search=invoice`)
          .set("x-tenant-id", tenantId);
        expect(res.status).toBe(200);
        const ids = (res.body.files as Array<{ id: string }>).map((f) => f.id);
        expect(ids).toContain(a.id);
        expect(ids).not.toContain(b.id);
      } finally {
        await prisma.file.delete({ where: { id: a.id } });
        await prisma.file.delete({ where: { id: b.id } });
        await prisma.folder.delete({ where: { id: folder.id } });
      }
    });

    it("GET /dev/files/list.json injects an IPX thumbnailUrl for image mime-types", async () => {
      const fileRow = await prisma.file.create({
        data: {
          tenantId,
          folderId: null,
          filename: "logo.png",
          mimeType: "image/png",
          sizeBytes: 2048,
          sha256: "0".repeat(64),
          storageDriver: "local",
          storageKey: `${tenantId}/null/logo.png`,
          uploaderId: "00000000-0000-0000-0000-000000000099",
        },
      });
      try {
        const res = await request(app.getHttpServer())
          .get("/api/hub/files/list.json")
          .set("x-tenant-id", tenantId);
        expect(res.status).toBe(200);
        const matched = (
          res.body.files as Array<{ id: string; thumbnailUrl?: string; mimeType: string }>
        ).find((f) => f.id === fileRow.id);
        expect(matched).toBeDefined();
        // Image rows get an IPX thumbnail URL; non-image rows should
        // not. The shape isn't asserted byte-for-byte, but it must
        // route through `/_ipx/` so the React grid can <img src>.
        expect(matched!.thumbnailUrl).toBeDefined();
        expect(matched!.thumbnailUrl).toContain("/_ipx/");
      } finally {
        await prisma.file.delete({ where: { id: fileRow.id } });
      }
    });

    it("GET /dev/files/breadcrumb.json returns Root for activeId=null", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/hub/files/breadcrumb.json")
        .set("x-tenant-id", tenantId);
      expect(res.status).toBe(200);
      expect(res.body.segments).toEqual([{ id: null, name: "Root" }]);
    });

    it("GET /dev/files/breadcrumb.json walks the parent chain back to the root", async () => {
      const root = await prisma.folder.create({
        data: { tenantId, parentId: null, name: "Customers" },
      });
      const child = await prisma.folder.create({
        data: { tenantId, parentId: root.id, name: "Acme" },
      });
      try {
        const res = await request(app.getHttpServer())
          .get(`/api/hub/files/breadcrumb.json?folderId=${child.id}`)
          .set("x-tenant-id", tenantId);
        expect(res.status).toBe(200);
        expect(res.body.segments).toEqual([
          { id: null, name: "Root" },
          { id: root.id, name: "Customers" },
          { id: child.id, name: "Acme" },
        ]);
      } finally {
        await prisma.folder.delete({ where: { id: child.id } });
        await prisma.folder.delete({ where: { id: root.id } });
      }
    });
  });

  describe("outside development mode", () => {
    let app: INestApplication;
    let previousNodeEnv: string | undefined;

    beforeAll(async () => {
      previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    });

    afterAll(async () => {
      await app.close();
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    });

    it("GET /dev/files/tree.json 404s in production", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/hub/files/tree.json")
        .set("x-tenant-id", "00000000-0000-0000-0000-000000000001");
      expect(res.status).toBe(404);
    });

    it("GET /dev/files/list.json 404s in production", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/hub/files/list.json")
        .set("x-tenant-id", "00000000-0000-0000-0000-000000000001");
      expect(res.status).toBe(404);
    });

    it("GET /dev/files/breadcrumb.json 404s in production", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/hub/files/breadcrumb.json")
        .set("x-tenant-id", "00000000-0000-0000-0000-000000000001");
      expect(res.status).toBe(404);
    });
  });
});
