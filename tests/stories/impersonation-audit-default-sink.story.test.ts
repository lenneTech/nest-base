import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  IMPERSONATION_AUDIT_SINK,
  type ImpersonationAuditSink,
} from "../../src/core/auth/impersonation.controller.js";
import { PrismaService } from "../../src/core/prisma/prisma.service.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
const TENANT_ID = "33333333-3333-3333-3333-333333333333";
const ADMIN_USER_ID = "44444444-4444-4444-4444-444444444444";
const TARGET_USER_ID = "55555555-5555-5555-5555-555555555555";
const SESSION_ID = "66666666-6666-6666-6666-666666666666";

/**
 * Story · ImpersonationAuditSink default writes to AuditLog (Finding 6).
 *
 * The PRD pins (SC.SUB.16): "Story test impersonates target user …
 * verifies … INVOKE audit row with kind: IMPERSONATION_START".
 * Iter-76 wired the `/hub/admin/impersonation/stop` controller + the
 * `IMPERSONATION_AUDIT_SINK` token but the default sink was a
 * no-op — projects had to override the binding to get any audit
 * row at all.
 *
 * Iter-86 closes the loop: the default
 * `IMPERSONATION_AUDIT_SINK` provider routes events to the
 * `audit_log` table via `$executeRaw` (the same shape the audit
 * extension's default-models test uses to side-step the Nest IoC
 * Proxy issue documented in iter-84). Out-of-the-box, calling
 * `sink.emit(event)` materialises a row with action='INVOKE' +
 * metadata.kind='IMPERSONATION_STOP' that the Audit Browser can
 * pivot on.
 */
describe("Story · default ImpersonationAuditSink writes to audit_log", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sink: ImpersonationAuditSink;

  beforeAll(async () => {
    process.env.FEATURE_AUDIT_ENABLED = "true";
    const { bootstrap } = await import("../../src/core/app/bootstrap.js");
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);
    sink = app.get<ImpersonationAuditSink>(IMPERSONATION_AUDIT_SINK);

    await prisma.auditLog.deleteMany({ where: { tenantId: TENANT_ID } });
  });

  afterAll(async () => {
    if (prisma) await prisma.auditLog.deleteMany({ where: { tenantId: TENANT_ID } });
    if (app) await app.close();
    delete process.env.FEATURE_AUDIT_ENABLED;
  });

  it("emit(IMPERSONATION_STOP event) writes a row with action='INVOKE' + metadata.kind='IMPERSONATION_STOP'", async () => {
    await sink.emit({
      action: "INVOKE",
      resource: "Session",
      resourceId: SESSION_ID,
      actorUserId: ADMIN_USER_ID,
      tenantId: TENANT_ID,
      ipAddress: "203.0.113.7",
      occurredAt: Date.now(),
      metadata: {
        kind: "IMPERSONATION_STOP",
        impersonatedUserId: TARGET_USER_ID,
        impersonatedBy: ADMIN_USER_ID,
      },
    });

    const rows = await prisma.auditLog.findMany({ where: { tenantId: TENANT_ID } });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.action).toBe("INVOKE");
    expect(row?.targetModel).toBe("Session");
    expect(row?.targetId).toBe(SESSION_ID);
    expect(row?.actorUserId).toBe(ADMIN_USER_ID);

    const metadata = row?.metadata as Record<string, unknown> | null;
    expect(metadata).toMatchObject({
      kind: "IMPERSONATION_STOP",
      impersonatedUserId: TARGET_USER_ID,
      impersonatedBy: ADMIN_USER_ID,
      ipAddress: "203.0.113.7",
    });
  });

  it("emit(IMPERSONATION_START event) writes a separate row with kind='IMPERSONATION_START'", async () => {
    const newSessionId = "77777777-7777-7777-7777-777777777777";
    await sink.emit({
      action: "INVOKE",
      resource: "Session",
      resourceId: newSessionId,
      actorUserId: ADMIN_USER_ID,
      tenantId: TENANT_ID,
      ipAddress: "203.0.113.8",
      occurredAt: Date.now(),
      metadata: {
        kind: "IMPERSONATION_START",
        impersonatedUserId: TARGET_USER_ID,
        impersonatedBy: ADMIN_USER_ID,
      },
    });

    const rows = await prisma.auditLog.findMany({
      where: { tenantId: TENANT_ID, targetId: newSessionId },
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.action).toBe("INVOKE");
    const metadata = row?.metadata as Record<string, unknown> | null;
    expect(metadata?.kind).toBe("IMPERSONATION_START");
  });

  it("when FEATURE_AUDIT_ENABLED=false, emit is a no-op (no row written)", async () => {
    // Disable audit explicitly — audit defaults to on, so leaving the
    // env var unset would still emit the row.
    process.env.FEATURE_AUDIT_ENABLED = "false";
    const { bootstrap } = await import("../../src/core/app/bootstrap.js");
    const app2 = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    const sink2 = app2.get<ImpersonationAuditSink>(IMPERSONATION_AUDIT_SINK);
    const prisma2 = app2.get(PrismaService);

    const skipSessionId = "88888888-8888-8888-8888-888888888888";
    await sink2.emit({
      action: "INVOKE",
      resource: "Session",
      resourceId: skipSessionId,
      actorUserId: ADMIN_USER_ID,
      tenantId: TENANT_ID,
      ipAddress: "203.0.113.9",
      occurredAt: Date.now(),
      metadata: {
        kind: "IMPERSONATION_STOP",
        impersonatedUserId: TARGET_USER_ID,
        impersonatedBy: ADMIN_USER_ID,
      },
    });

    const rows = await prisma2.auditLog.findMany({
      where: { tenantId: TENANT_ID, targetId: skipSessionId },
    });
    expect(rows).toHaveLength(0);

    await app2.close();
    process.env.FEATURE_AUDIT_ENABLED = "true";
  });
});
