import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaService } from "../src/core/prisma/prisma.service.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
// Per-suite tenant UUID isolates this spec's seeded audit_log rows
// from concurrent specs writing to the same `audit_log` table
// (`audit-log-model.e2e-spec.ts` shared the hardcoded
// `11111111-…-111111111111` UUID; iter-194 shifts to a per-suite
// random UUID so the iter-185-style isolation prefix pattern applies
// to the audit subsystem too — concurrent afterAll deletions on the
// same tenant no longer wipe this spec's seeded rows mid-test).
const TENANT = crypto.randomUUID();

/**
 * E2E · Audit Browser data source (`/admin/audit.json`).
 *
 * Iter-66 added the `AuditLog` Prisma model + table; iter-67 added
 * the audit Prisma extension that writes rows on opted-in CUDs;
 * iter-71 wires the Audit Browser controller to actually read those
 * rows back out.
 *
 * The controller (`AdminSpaController.auditBrowserJson`) accepts
 * `action / resource / actorUserId / from / to` query filters and
 * returns the `entries: AuditLogEntry[]` shape the React page
 * consumes. The composite indexes on the model
 * (`[tenantId, createdAt]`, `[targetModel, targetId]`,
 * `[actorUserId, createdAt]`) cover the most common pivots.
 */
describe("E2E · Audit Browser data source (/admin/audit.json)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let previousNodeEnv: string | undefined;

  beforeAll(async () => {
    previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const { bootstrap } = await import("../src/core/app/bootstrap.js");
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);

    // Seed three audit rows so the assertions don't rely on side-effects
    // from other tests.
    await prisma.auditLog.create({
      data: {
        tenantId: TENANT,
        actorUserId: null,
        targetModel: "Tenant",
        targetId: "tenant-a",
        action: "CREATE",
        diff: { after: { name: "Acme" } },
      },
    });
    await prisma.auditLog.create({
      data: {
        tenantId: TENANT,
        actorUserId: "00000000-0000-0000-0000-000000000099",
        targetModel: "ApiKey",
        targetId: "key-1",
        action: "DELETE",
        diff: { before: { id: "key-1", expiresAt: "2030-01-01" } },
      },
    });
    await prisma.auditLog.create({
      data: {
        tenantId: TENANT,
        actorUserId: null,
        targetModel: "Tenant",
        targetId: "tenant-a",
        action: "UPDATE",
        diff: { before: { name: "Acme" }, after: { name: "Acme Inc." } },
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.auditLog.deleteMany({ where: { tenantId: TENANT } });
    } catch {
      // ignore — testcontainer is tossed by global-setup anyway
    }
    await app.close();
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });

  it("GET /admin/audit.json returns all audit rows mapped to the read-model shape", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/admin/audit.json")
      .set("x-tenant-id", TENANT);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries.length).toBeGreaterThanOrEqual(3);

    // Every entry has the shape AuditBrowserPageInput['entries'][n] expects.
    for (const entry of res.body.entries) {
      expect(typeof entry.id).toBe("string");
      expect(typeof entry.action).toBe("string");
      expect(typeof entry.resource).toBe("string");
      expect(typeof entry.tenantId).toBe("string");
      expect(typeof entry.occurredAt).toBe("string");
    }
  });

  it("?action=create filters to CREATE-action rows (case-insensitive)", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/admin/audit.json?action=create")
      .set("x-tenant-id", TENANT);
    expect(res.status).toBe(200);
    expect(res.body.filter).toEqual({ action: "create" });
    for (const entry of res.body.entries) {
      expect(entry.action).toBe("create");
    }
    expect(res.body.entries.length).toBeGreaterThanOrEqual(1);
  });

  it("?resource=Tenant filters to the Tenant target model", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/admin/audit.json?resource=Tenant")
      .set("x-tenant-id", TENANT);
    expect(res.status).toBe(200);
    expect(res.body.filter.resource).toBe("Tenant");
    for (const entry of res.body.entries) {
      expect(entry.resource).toBe("Tenant");
    }
    expect(res.body.entries.length).toBeGreaterThanOrEqual(2);
  });

  it("entries carry the `before` / `after` diff payloads from the JSON column", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/admin/audit.json")
      .set("x-tenant-id", TENANT);
    const updateEntry = (
      res.body.entries as Array<{ action: string; before?: object; after?: object }>
    ).find((e) => e.action === "update");
    expect(updateEntry).toBeDefined();
    expect(updateEntry!.before).toBeDefined();
    expect(updateEntry!.after).toBeDefined();
  });

  it("orders rows by createdAt DESC (most recent first)", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/admin/audit.json")
      .set("x-tenant-id", TENANT);
    expect(res.status).toBe(200);
    const occurredAts = (res.body.entries as Array<{ occurredAt: string }>).map((e) =>
      new Date(e.occurredAt).getTime(),
    );
    for (let i = 1; i < occurredAts.length; i++) {
      expect(occurredAts[i - 1]).toBeGreaterThanOrEqual(occurredAts[i]!);
    }
  });

  it("400s when the x-tenant-id header is missing (iter-201 defense-in-depth alongside RLS)", async () => {
    // Iter-201 G2 closure: the controller now requires an explicit
    // `x-tenant-id` header even though `audit_log` has RLS enabled.
    // The explicit predicate is defense-in-depth against an operator
    // omitting the header — without it, the query relied entirely on
    // RLS for tenant isolation. Now the controller surfaces a 400 at
    // the request boundary instead of falling through.
    const res = await request(app.getHttpServer()).get("/api/admin/audit.json");
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/x-tenant-id/i);
  });

  it("returns ONLY rows for the request's tenant — concurrent tenants' audit rows do NOT leak", async () => {
    // Iter-201: explicit `tenantId` filter at the controller layer.
    // Insert a row under a DIFFERENT tenant id; the audit-browser
    // response for OUR tenant must not include it.
    const otherTenant = crypto.randomUUID();
    const otherRow = await prisma.auditLog.create({
      data: {
        tenantId: otherTenant,
        actorUserId: null,
        targetModel: "Tenant",
        targetId: "other-leak-target",
        action: "CREATE",
        diff: { after: { name: "leaked" } },
      },
    });
    try {
      const res = await request(app.getHttpServer())
        .get("/api/admin/audit.json")
        .set("x-tenant-id", TENANT);
      expect(res.status).toBe(200);
      const ids = (res.body.entries as Array<{ id: string }>).map((e) => e.id);
      expect(ids).not.toContain(otherRow.id);
    } finally {
      await prisma.auditLog.delete({ where: { id: otherRow.id } });
    }
  });

  it("404s outside development mode (NODE_ENV=production)", async () => {
    // Quick negative case — the assertDev() guard fires regardless of
    // tenant header, so the test boots a separate app instance with
    // NODE_ENV=production.
    process.env.NODE_ENV = "production";
    const { bootstrap } = await import("../src/core/app/bootstrap.js");
    const prodApp = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    const res = await request(prodApp.getHttpServer())
      .get("/api/admin/audit.json")
      .set("x-tenant-id", TENANT);
    expect(res.status).toBe(404);
    await prodApp.close();
    process.env.NODE_ENV = "development";
  });
});
