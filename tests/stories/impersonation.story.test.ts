import { describe, expect, it } from "vitest";

/**
 * Story · Impersonation audit event (SC.SUB.16).
 *
 * The PRD's `SC.SUB.16` requires that when an admin impersonates a
 * user, the resulting session carries an `impersonatedBy` field
 * AND an `INVOKE` audit row lands with `kind: "IMPERSONATION_START"`.
 * Stopping impersonation emits `INVOKE` + `kind: "IMPERSONATION_STOP"`.
 *
 * This slice owns the canonical *event shape* the impersonation
 * controller emits — the actual session-mint / session-tear-down
 * runtime is wired by the Better-Auth `admin` plugin (CF.AUTH.05,
 * iter-41). Keeping the event shape in a pure builder lets the
 * audit-log filter UI (CF.AUDIT.07-12) drive its action filter
 * dropdown straight from the discriminated union.
 *
 * Hard rule: the impersonatedUserId is recorded as the *resource*
 * (not the actor) so the audit row reads as "admin invoked an
 * impersonation against userX" — auditors look at it from the
 * affected-user's perspective.
 */
describe("Story · Impersonation audit event builder", () => {
  it("builds an IMPERSONATION_START event with both actors recorded", async () => {
    const { buildImpersonationAuditEvent } =
      await import("../../src/core/auth/impersonation.audit.js");
    const event = buildImpersonationAuditEvent({
      kind: "start",
      adminUserId: "admin-1",
      impersonatedUserId: "u1",
      newSessionId: "s-new",
      tenantId: "t1",
      ipAddress: "10.0.0.1",
      occurredAt: 1_700_000_000_000,
    });

    expect(event.action).toBe("INVOKE");
    expect(event.resource).toBe("Session");
    expect(event.resourceId).toBe("s-new");
    expect(event.actorUserId).toBe("admin-1");
    expect(event.tenantId).toBe("t1");
    expect(event.ipAddress).toBe("10.0.0.1");
    expect(event.occurredAt).toBe(1_700_000_000_000);
    expect(event.metadata).toEqual({
      kind: "IMPERSONATION_START",
      impersonatedUserId: "u1",
      impersonatedBy: "admin-1",
    });
  });

  it("builds an IMPERSONATION_STOP event referencing the same session", async () => {
    const { buildImpersonationAuditEvent } =
      await import("../../src/core/auth/impersonation.audit.js");
    const event = buildImpersonationAuditEvent({
      kind: "stop",
      adminUserId: "admin-1",
      impersonatedUserId: "u1",
      sessionId: "s-imp",
      tenantId: "t1",
      ipAddress: "10.0.0.1",
      occurredAt: 1_700_000_000_000,
    });
    expect(event.action).toBe("INVOKE");
    expect(event.resource).toBe("Session");
    expect(event.resourceId).toBe("s-imp");
    expect(event.metadata).toMatchObject({
      kind: "IMPERSONATION_STOP",
      impersonatedUserId: "u1",
      impersonatedBy: "admin-1",
    });
  });

  it("rejects when adminUserId equals impersonatedUserId (self-impersonation makes no sense)", async () => {
    const { buildImpersonationAuditEvent } =
      await import("../../src/core/auth/impersonation.audit.js");
    expect(() =>
      buildImpersonationAuditEvent({
        kind: "start",
        adminUserId: "u1",
        impersonatedUserId: "u1",
        newSessionId: "s-new",
        tenantId: "t1",
        ipAddress: "10.0.0.1",
        occurredAt: 1_700_000_000_000,
      }),
    ).toThrow(/self-impersonat/i);
  });

  it("rejects empty session id", async () => {
    const { buildImpersonationAuditEvent } =
      await import("../../src/core/auth/impersonation.audit.js");
    expect(() =>
      buildImpersonationAuditEvent({
        kind: "start",
        adminUserId: "admin-1",
        impersonatedUserId: "u1",
        newSessionId: "",
        tenantId: "t1",
        ipAddress: "10.0.0.1",
        occurredAt: 1_700_000_000_000,
      }),
    ).toThrow(/session/i);
  });

  it("metadata.impersonatedBy mirrors actorUserId so filters can pivot on either", async () => {
    const { buildImpersonationAuditEvent } =
      await import("../../src/core/auth/impersonation.audit.js");
    const event = buildImpersonationAuditEvent({
      kind: "start",
      adminUserId: "admin-2",
      impersonatedUserId: "u2",
      newSessionId: "s-new-2",
      tenantId: "t1",
      ipAddress: "10.0.0.1",
      occurredAt: 1_700_000_000_000,
    });
    expect(event.actorUserId).toBe("admin-2");
    expect((event.metadata as Record<string, string>).impersonatedBy).toBe("admin-2");
  });
});
