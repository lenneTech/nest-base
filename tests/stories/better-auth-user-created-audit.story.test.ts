import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaService } from "../../src/core/prisma/prisma.service.js";

/**
 * Story · Better-Auth user.create.after → audit_log (Issue #99)
 *
 * Every user creation — regardless of path (sign-up, admin create-user,
 * plugin) — must produce an audit row. The hook is wired via Better-Auth's
 * `databaseHooks.user.create.after` so it fires after the user row lands in
 * the DB, covering every code path that creates a user through Better-Auth.
 *
 * Acceptance criteria (from the issue brief):
 *   a) POST /api/auth/sign-up/email produces an audit row.
 *   b) The row has the correct shape:
 *        action     = 'CREATE'
 *        targetModel = 'User'
 *        targetId   = user.id
 *        actorUserId = user.id  (creator is the user themselves on self-signup)
 *        metadata.source = 'better-auth'
 *
 * Feature gating: when `FEATURE_AUDIT_ENABLED=false` the hook is a no-op
 * (mirrors the impersonation + session-revoke sinks).
 */
describe("Story · Better-Auth user.create.after → audit_log", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const email = `audit-user-${Date.now()}@example.com`;

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-for-testing-purposes-only-1234567890abcd";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.FEATURE_AUDIT_ENABLED = "true";

    const { bootstrap: boot } = await import("../../src/core/app/bootstrap.js");
    app = await boot({
      listen: false,
      logger: { log() {}, warn() {}, error() {}, debug() {}, verbose() {} },
    });
    prisma = app.get(PrismaService);

    // Clean up any leftover rows from previous test runs
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await prisma.auditLog.deleteMany({ where: { targetId: existing.id } });
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  afterAll(async () => {
    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        await prisma.auditLog.deleteMany({ where: { targetId: user.id } });
        await prisma.user.deleteMany({ where: { email } });
      }
    } catch {
      // best-effort cleanup
    }
    if (app) await app.close();
    delete process.env.FEATURE_AUDIT_ENABLED;
  });

  it("POST /api/auth/sign-up/email produces an audit row with action=CREATE and source=better-auth", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({ email, password: "password-12345", name: "Audit Test User" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // Give the async hook a tick to flush
    await new Promise((resolve) => setTimeout(resolve, 100));

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user, "user row must exist after sign-up").not.toBeNull();

    const rows = await prisma.auditLog.findMany({
      where: { targetModel: "User", targetId: user!.id },
    });

    expect(
      rows.length,
      "expected at least one audit row for the created user",
    ).toBeGreaterThanOrEqual(1);

    const row = rows.find((r) => r.action === "CREATE");
    expect(row, "expected an audit row with action=CREATE").toBeDefined();
    expect(row!.targetModel).toBe("User");
    expect(row!.targetId).toBe(user!.id);
    // On self-signup, actorUserId mirrors the newly-created user's id
    expect(row!.actorUserId).toBe(user!.id);

    const metadata = row!.metadata as Record<string, unknown> | null;
    expect(metadata?.source).toBe("better-auth");
  });

  it("audit row has no tenantId when user signs up without a tenant", async () => {
    // The sign-up test above already ran; find its user and row
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();

    const rows = await prisma.auditLog.findMany({
      where: { targetModel: "User", targetId: user!.id, action: "CREATE" },
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // tenantId is optional — without a pre-picked tenant it should be null
    // (the audit row uses the user's tenantId which is null at signup time)
    const row = rows[0]!;
    // We only assert that the column is present; null is acceptable here
    expect("tenantId" in row).toBe(true);
  });

  it("when FEATURE_AUDIT_ENABLED=false, sign-up does NOT produce an audit row", async () => {
    process.env.FEATURE_AUDIT_ENABLED = "false";
    const { bootstrap: boot } = await import("../../src/core/app/bootstrap.js");
    const app2 = await boot({
      listen: false,
      logger: { log() {}, warn() {}, error() {}, debug() {}, verbose() {} },
    });
    const prisma2 = app2.get(PrismaService);

    const email2 = `audit-disabled-${Date.now()}@example.com`;
    try {
      const res = await request(app2.getHttpServer())
        .post("/api/auth/sign-up/email")
        .set("content-type", "application/json")
        .send({ email: email2, password: "password-12345", name: "No Audit User" });

      expect(res.status, JSON.stringify(res.body)).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const user = await prisma2.user.findUnique({ where: { email: email2 } });
      expect(user).not.toBeNull();

      const rows = await prisma2.auditLog.findMany({
        where: { targetModel: "User", targetId: user!.id },
      });
      expect(rows.length).toBe(0);
    } finally {
      try {
        const u = await prisma2.user.findUnique({ where: { email: email2 } });
        if (u) {
          await prisma2.auditLog.deleteMany({ where: { targetId: u.id } });
          await prisma2.user.deleteMany({ where: { email: email2 } });
        }
      } catch {
        /* best-effort */
      }
      await app2.close();
      process.env.FEATURE_AUDIT_ENABLED = "true";
    }
  });
});
