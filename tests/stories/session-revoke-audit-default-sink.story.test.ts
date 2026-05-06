import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  SESSION_REVOKE_AUDIT_SINK,
  type SessionRevokeAuditSink,
} from "../../src/core/auth/sessions-admin.controller.js";
import { PrismaService } from "../../src/core/prisma/prisma.service.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
const TENANT_ID = "00000000-0000-0000-0000-0000000000d1";
const ADMIN_USER_ID = "00000000-0000-0000-0000-0000000000d2";
const REVOKED_SESSION_ID = "00000000-0000-0000-0000-0000000000d3";

/**
 * Story · default SessionRevokeAuditSink writes to audit_log
 * (CF.AUTH.SESSIONS — Finding 6 from iter-84 reviewer, parallel to
 * iter-86's impersonation sink).
 *
 * Iter-76 added the `SESSION_REVOKE_AUDIT_SINK` token but bound it
 * to a no-op default — every session-revoke flow (single,
 * bulk-by-user, log-out-others) silently dropped the audit envelope.
 * Iter-90 closes the loop: the default sink writes a row with
 * `action='REVOKE'` + `metadata.kind='SESSION_REVOKED'` +
 * `metadata.strategy=<single|bulk-by-user|...>` so the Audit
 * Browser can pivot on either field.
 */
describe("Story · default SessionRevokeAuditSink writes to audit_log", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sink: SessionRevokeAuditSink;

  beforeAll(async () => {
    process.env.FEATURE_AUDIT_ENABLED = "true";
    const { bootstrap } = await import("../../src/core/app/bootstrap.js");
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);
    sink = app.get<SessionRevokeAuditSink>(SESSION_REVOKE_AUDIT_SINK);
    await prisma.auditLog.deleteMany({ where: { tenantId: TENANT_ID } });
  });

  afterAll(async () => {
    if (prisma) await prisma.auditLog.deleteMany({ where: { tenantId: TENANT_ID } });
    if (app) await app.close();
    delete process.env.FEATURE_AUDIT_ENABLED;
  });

  it("emit() writes a row with action='REVOKE' + metadata.kind='SESSION_REVOKED' + strategy", async () => {
    await sink.emit({
      action: "REVOKE",
      resource: "Session",
      resourceId: REVOKED_SESSION_ID,
      actorUserId: ADMIN_USER_ID,
      tenantId: TENANT_ID,
      occurredAt: Date.now(),
      metadata: {
        kind: "SESSION_REVOKED",
        strategy: "single",
      },
    });

    const rows = await prisma.auditLog.findMany({
      where: { tenantId: TENANT_ID, targetId: REVOKED_SESSION_ID },
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.action).toBe("REVOKE");
    expect(row?.targetModel).toBe("Session");
    expect(row?.targetId).toBe(REVOKED_SESSION_ID);
    expect(row?.actorUserId).toBe(ADMIN_USER_ID);

    const metadata = row?.metadata as Record<string, unknown> | null;
    expect(metadata).toMatchObject({
      kind: "SESSION_REVOKED",
      strategy: "single",
    });
  });

  it("emit() with bulk-by-user strategy records the strategy in metadata", async () => {
    const bulkSessionId = "00000000-0000-0000-0000-0000000000d4";
    await sink.emit({
      action: "REVOKE",
      resource: "Session",
      resourceId: bulkSessionId,
      actorUserId: ADMIN_USER_ID,
      tenantId: TENANT_ID,
      occurredAt: Date.now(),
      metadata: {
        kind: "SESSION_REVOKED",
        strategy: "bulk-by-user",
      },
    });

    const rows = await prisma.auditLog.findMany({
      where: { tenantId: TENANT_ID, targetId: bulkSessionId },
    });
    expect(rows).toHaveLength(1);
    const metadata = rows[0]?.metadata as Record<string, unknown> | null;
    expect(metadata?.strategy).toBe("bulk-by-user");
  });

  it("when FEATURE_AUDIT_ENABLED=false, emit is a no-op", async () => {
    process.env.FEATURE_AUDIT_ENABLED = "false";
    const { bootstrap } = await import("../../src/core/app/bootstrap.js");
    const app2 = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    const sink2 = app2.get<SessionRevokeAuditSink>(SESSION_REVOKE_AUDIT_SINK);
    const prisma2 = app2.get(PrismaService);

    const skipSessionId = "00000000-0000-0000-0000-0000000000d5";
    await sink2.emit({
      action: "REVOKE",
      resource: "Session",
      resourceId: skipSessionId,
      actorUserId: ADMIN_USER_ID,
      tenantId: TENANT_ID,
      occurredAt: Date.now(),
      metadata: {
        kind: "SESSION_REVOKED",
        strategy: "single",
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
