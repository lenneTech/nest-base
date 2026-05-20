import { describe, expect, it, vi } from "vitest";

/**
 * Story · Sessions admin revoke planner (CF.AUTH.21 + CF.AUTH.22).
 *
 * The PRD's `CF.AUTH.21` (revoke single) and `CF.AUTH.22` (bulk-by-user
 * revoke) require an admin surface that selects sessions for
 * termination. This slice owns the *selection planner* — given the
 * full session inventory + a revoke strategy, return the list of
 * sessionIds to terminate.
 *
 * The runner (Better-Auth's session adapter) iterates that list and
 * deletes each row. The planner stays pure so the selection logic is
 * trivially testable against fixtures.
 *
 * Strategies:
 *   - `{ kind: "single", sessionId }` — exactly one session.
 *   - `{ kind: "bulk-by-user", userId }` — every session owned by
 *     the user.
 *   - `{ kind: "bulk-by-user-except-current", userId, currentSessionId }`
 *     — every session for the user EXCEPT the one the admin/user is
 *     currently using (so the impersonator/admin doesn't immediately
 *     log themselves out).
 *
 * Hard rule: never revoke the impersonator's session by accident —
 * the `bulk-by-user-except-current` variant is the safe default for
 * UX flows that show "log me out everywhere else" buttons.
 */
describe("Story · Sessions admin revoke planner", () => {
  // H3 fix: SessionRecord now carries tenantId so the controller can scope
  // listAllSessions() to a single tenant. Fixtures are updated to include it.
  const sessions = [
    { id: "s1", userId: "u1", createdAt: 1_000, tenantId: "t1" },
    { id: "s2", userId: "u1", createdAt: 2_000, tenantId: "t1" },
    { id: "s3", userId: "u1", createdAt: 3_000, tenantId: "t1" },
    { id: "s4", userId: "u2", createdAt: 4_000, tenantId: "t1" },
    { id: "s5", userId: "u2", createdAt: 5_000, tenantId: "t1" },
  ];

  describe("single revoke", () => {
    it("selects exactly the named session", async () => {
      const { planSessionRevoke } = await import("../../src/core/auth/sessions-admin.planner.js");
      const result = planSessionRevoke({
        sessions,
        strategy: { kind: "single", sessionId: "s2" },
      });
      expect(result.sessionIds).toEqual(["s2"]);
    });

    it("returns an empty list when the named session does not exist", async () => {
      const { planSessionRevoke } = await import("../../src/core/auth/sessions-admin.planner.js");
      const result = planSessionRevoke({
        sessions,
        strategy: { kind: "single", sessionId: "nonexistent" },
      });
      expect(result.sessionIds).toEqual([]);
    });
  });

  describe("bulk-by-user revoke", () => {
    it("selects every session belonging to the user", async () => {
      const { planSessionRevoke } = await import("../../src/core/auth/sessions-admin.planner.js");
      const result = planSessionRevoke({
        sessions,
        strategy: { kind: "bulk-by-user", userId: "u1" },
      });
      expect(result.sessionIds.sort()).toEqual(["s1", "s2", "s3"]);
    });

    it("returns an empty list when the user has no sessions", async () => {
      const { planSessionRevoke } = await import("../../src/core/auth/sessions-admin.planner.js");
      const result = planSessionRevoke({
        sessions,
        strategy: { kind: "bulk-by-user", userId: "u-nonexistent" },
      });
      expect(result.sessionIds).toEqual([]);
    });

    it("isolates by user (revoking u1 leaves u2 untouched)", async () => {
      const { planSessionRevoke } = await import("../../src/core/auth/sessions-admin.planner.js");
      const result = planSessionRevoke({
        sessions,
        strategy: { kind: "bulk-by-user", userId: "u1" },
      });
      expect(result.sessionIds).not.toContain("s4");
      expect(result.sessionIds).not.toContain("s5");
    });
  });

  describe("bulk-by-user-except-current revoke", () => {
    it("excludes the named current session from the revoke list", async () => {
      const { planSessionRevoke } = await import("../../src/core/auth/sessions-admin.planner.js");
      const result = planSessionRevoke({
        sessions,
        strategy: {
          kind: "bulk-by-user-except-current",
          userId: "u1",
          currentSessionId: "s2",
        },
      });
      expect(result.sessionIds.sort()).toEqual(["s1", "s3"]);
    });

    it("falls back to all-of-user when currentSessionId does not match", async () => {
      const { planSessionRevoke } = await import("../../src/core/auth/sessions-admin.planner.js");
      const result = planSessionRevoke({
        sessions,
        strategy: {
          kind: "bulk-by-user-except-current",
          userId: "u1",
          currentSessionId: "s99",
        },
      });
      expect(result.sessionIds.sort()).toEqual(["s1", "s2", "s3"]);
    });
  });

  describe("H3 fix: tenant-scoped session listing", () => {
    it("SessionRecord carries a tenantId field", async () => {
      const { planSessionRevoke } = await import("../../src/core/auth/sessions-admin.planner.js");
      // The planner itself doesn't filter by tenant (that is the storage's job —
      // listAllSessions() accepts an optional tenantId). The planner operates on
      // whatever list the storage returns. This test documents that SessionRecord
      // now has tenantId and the planner passes it through correctly.
      const crossTenantSessions = [
        { id: "s1", userId: "u1", createdAt: 1_000, tenantId: "t1" },
        { id: "s2", userId: "u1", createdAt: 2_000, tenantId: "t2" }, // different tenant
      ];
      // Without tenant pre-filtering the planner selects both (storage is responsible
      // for the tenant gate). Verifies the planner does not accidentally filter.
      const result = planSessionRevoke({
        sessions: crossTenantSessions,
        strategy: { kind: "bulk-by-user", userId: "u1" },
      });
      expect(result.sessionIds.sort()).toEqual(["s1", "s2"]);
    });
  });
});

// ─── Finding 11: controller passes session activeOrganizationId to listAllSessions ─

describe("Finding 11 · SessionsAdminController passes tenantId to listAllSessions", () => {
  it("calls listAllSessions with the requesting user's activeOrganizationId", async () => {
    // Verify the controller forwards session.activeOrganizationId to listAllSessions
    // so the storage adapter can apply the tenant gate. Without this
    // pass-through, a super-admin would enumerate sessions for all tenants
    // instead of just their own (H3 fix — controller-level coverage).

    const { SessionsAdminController, SESSION_REVOKE_STORAGE, SESSION_REVOKE_AUDIT_SINK } =
      await import("../../src/core/auth/sessions-admin.controller.js");
    const { Test } = await import("@nestjs/testing");

    const listAllSessions = vi.fn().mockResolvedValue([]);
    const revokeSession = vi.fn().mockResolvedValue(undefined);
    const auditEmit = vi.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      controllers: [SessionsAdminController],
      providers: [
        {
          provide: SESSION_REVOKE_STORAGE,
          useValue: { listAllSessions, revokeSession },
        },
        {
          provide: SESSION_REVOKE_AUDIT_SINK,
          useValue: { emit: auditEmit },
        },
      ],
    }).compile();

    const controller = moduleRef.get(SessionsAdminController);

    // Simulate a request from a user with active org "t1" (session tenant scope)
    const fakeReq = { user: { id: "u1", activeOrganizationId: "t1" }, headers: {} };
    await controller.sessionsListJson(fakeReq as never);

    // The controller must forward "t1" — NOT undefined
    expect(listAllSessions).toHaveBeenCalledWith("t1");
  });
});
