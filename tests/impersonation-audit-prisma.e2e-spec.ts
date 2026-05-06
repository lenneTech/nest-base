import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildImpersonationAuditEvent } from "../src/core/auth/impersonation.audit.js";
import { DefaultImpersonationAuditSink } from "../src/core/auth/impersonation.audit-sink.js";
import { IMPERSONATION_AUDIT_SINK } from "../src/core/auth/impersonation.controller.js";
import type { ImpersonationAuditSink } from "../src/core/auth/impersonation.controller.js";
import { PrismaService } from "../src/core/prisma/prisma.service.js";
import { uuidV7 } from "../src/core/uuid/uuid-v7.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * E2E · Impersonation audit envelope live SELECT round-trip
 * (SC.SUB.16 closure — iter-189).
 *
 * The deviation register's SC.SUB.* row notes SC.SUB.16's PRD pin:
 * "Story test impersonates target user … verifies … INVOKE audit
 * row with kind: IMPERSONATION_START". The existing
 * `tests/stories/impersonation.story.test.ts` covers
 * `buildImpersonationAuditEvent` (the planner) but stops short of
 * the `DefaultImpersonationAuditSink.emit` SQL path.
 *
 * This e2e closes that gap by:
 *   1. Booting the full app via `bootstrap()` so the sink picks up
 *      the production `PrismaService`.
 *   2. Resolving `DefaultImpersonationAuditSink` via `app.get()`.
 *   3. Driving an IMPERSONATION_START event through `emit(...)` with
 *      the planner-built envelope.
 *   4. Reading back via `prisma.auditLog.findMany({where:{targetModel:
 *      "Session", targetId: sessionId}})` and asserting the row's
 *      action, target, metadata.kind, metadata.impersonatedUserId,
 *      and metadata.impersonatedBy match the envelope.
 *
 * Per-suite tenantId isolates the assertions from concurrent specs.
 */
describe("E2E · Impersonation audit-sink Prisma round-trip (SC.SUB.16)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sink: ImpersonationAuditSink;
  let tenantId: string;
  const ADMIN_ID = "00000000-0000-0000-0000-0000000000a1";
  const TARGET_ID = "00000000-0000-0000-0000-0000000000b2";

  beforeAll(async () => {
    const { bootstrap } = await import("../src/core/app/bootstrap.js");
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);
    // Wired via `IMPERSONATION_AUDIT_SINK` symbol in
    // sessions-admin.module.ts:62 to a `new DefaultImpersonationAuditSink(prisma)` —
    // resolve through the token to get the production binding.
    sink = app.get<ImpersonationAuditSink>(IMPERSONATION_AUDIT_SINK);
    expect(sink).toBeInstanceOf(DefaultImpersonationAuditSink);

    const orgName = `imp-audit-e2e-${crypto.randomUUID()}`;
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
      await prisma.auditLog.deleteMany({ where: { tenantId } });
      await prisma.organization.delete({ where: { id: tenantId } });
    } catch {
      /* best-effort cleanup */
    }
    await app.close();
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany({ where: { tenantId } });
  });

  it("emit(IMPERSONATION_START) lands an INVOKE audit row carrying both impersonatedUserId + impersonatedBy in metadata", async () => {
    const sessionId = `imp-${crypto.randomUUID()}`;
    const event = buildImpersonationAuditEvent({
      kind: "start",
      adminUserId: ADMIN_ID,
      impersonatedUserId: TARGET_ID,
      tenantId,
      ipAddress: "10.0.0.1",
      newSessionId: sessionId,
      occurredAt: Date.now(),
    });

    await sink.emit(event);

    const rows = await prisma.auditLog.findMany({
      where: { targetModel: "Session", targetId: sessionId },
    });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.action).toBe("INVOKE");
    expect(row.tenantId).toBe(tenantId);
    expect(row.actorUserId).toBe(ADMIN_ID);
    const meta = row.metadata as Record<string, unknown>;
    expect(meta.kind).toBe("IMPERSONATION_START");
    expect(meta.impersonatedUserId).toBe(TARGET_ID);
    expect(meta.impersonatedBy).toBe(ADMIN_ID);
    expect(meta.ipAddress).toBe("10.0.0.1");
  });

  it("emit(IMPERSONATION_STOP) lands an INVOKE audit row carrying the IMPERSONATION_STOP metadata kind", async () => {
    const sessionId = `imp-${crypto.randomUUID()}`;
    const event = buildImpersonationAuditEvent({
      kind: "stop",
      adminUserId: ADMIN_ID,
      impersonatedUserId: TARGET_ID,
      tenantId,
      ipAddress: "10.0.0.2",
      sessionId,
      occurredAt: Date.now(),
    });

    await sink.emit(event);

    const rows = await prisma.auditLog.findMany({
      where: { targetModel: "Session", targetId: sessionId },
    });
    expect(rows).toHaveLength(1);
    const meta = rows[0]?.metadata as Record<string, unknown>;
    expect(meta.kind).toBe("IMPERSONATION_STOP");
    expect(meta.impersonatedUserId).toBe(TARGET_ID);
  });

  it("multiple START + STOP events for the same admin/target pair land as separate audit rows", async () => {
    const startSessionId = `imp-start-${crypto.randomUUID()}`;
    const stopSessionId = `imp-stop-${crypto.randomUUID()}`;
    await sink.emit(
      buildImpersonationAuditEvent({
        kind: "start",
        adminUserId: ADMIN_ID,
        impersonatedUserId: TARGET_ID,
        tenantId,
        ipAddress: "10.0.0.3",
        newSessionId: startSessionId,
        occurredAt: Date.now(),
      }),
    );
    await sink.emit(
      buildImpersonationAuditEvent({
        kind: "stop",
        adminUserId: ADMIN_ID,
        impersonatedUserId: TARGET_ID,
        tenantId,
        ipAddress: "10.0.0.3",
        sessionId: stopSessionId,
        occurredAt: Date.now(),
      }),
    );

    const rows = await prisma.auditLog.findMany({
      where: { tenantId, targetModel: "Session", actorUserId: ADMIN_ID },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    const kinds = rows.map((r) => (r.metadata as Record<string, unknown>).kind);
    expect(kinds).toEqual(["IMPERSONATION_START", "IMPERSONATION_STOP"]);
  });

  it("the audit-log row uses action='INVOKE' (the audit_action enum addition from migration 20260505080000_audit_action_invoke)", async () => {
    const sessionId = `imp-enum-${crypto.randomUUID()}`;
    await sink.emit(
      buildImpersonationAuditEvent({
        kind: "start",
        adminUserId: ADMIN_ID,
        impersonatedUserId: TARGET_ID,
        tenantId,
        ipAddress: "10.0.0.4",
        newSessionId: sessionId,
        occurredAt: Date.now(),
      }),
    );

    // Raw SQL probe — confirms the row's `action` column carries
    // exactly the `INVOKE` enum value the sink writes via $executeRaw.
    const raw = (await prisma.$queryRawUnsafe(
      `SELECT action::text AS action FROM audit_log WHERE tenant_id = $1::uuid AND target_id = $2`,
      tenantId,
      sessionId,
    )) as Array<{ action: string }>;
    expect(raw).toHaveLength(1);
    expect(raw[0]?.action).toBe("INVOKE");
  });

  it("an audit-disabled feature flag silently no-ops emit (no row landed)", async () => {
    const original = process.env.FEATURE_AUDIT_ENABLED;
    try {
      process.env.FEATURE_AUDIT_ENABLED = "false";
      const sessionId = `imp-noop-${crypto.randomUUID()}`;
      await sink.emit(
        buildImpersonationAuditEvent({
          kind: "start",
          adminUserId: ADMIN_ID,
          impersonatedUserId: TARGET_ID,
          tenantId,
          ipAddress: "10.0.0.5",
          newSessionId: sessionId,
          occurredAt: Date.now(),
        }),
      );

      const rows = await prisma.auditLog.findMany({
        where: { targetModel: "Session", targetId: sessionId },
      });
      expect(rows).toEqual([]);
    } finally {
      if (original === undefined) delete process.env.FEATURE_AUDIT_ENABLED;
      else process.env.FEATURE_AUDIT_ENABLED = original;
    }
  });
});
