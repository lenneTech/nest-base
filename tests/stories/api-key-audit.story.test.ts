import { describe, expect, it } from "vitest";

/**
 * Story · API key audit trail (CF.AUTH.19).
 *
 * The PRD's `CF.AUTH.19` requires every meaningful API-key lifecycle
 * event to land in the audit log. The audit log itself is wired
 * elsewhere (CF.AUDIT.01) — this slice owns the *event shape* that
 * the API-key service emits when a key is created / rotated / revoked
 * / verified / fails verification.
 *
 * The builder is pure: given the operation kind + key metadata +
 * actor context, it returns the canonical audit-log entry shape
 * (matching CF.AUDIT.01's envelope) so the existing audit pipeline
 * can persist it.
 *
 * Discriminated union of events:
 *   - api-key.created
 *   - api-key.rotated
 *   - api-key.revoked
 *   - api-key.verified
 *   - api-key.verify-failed
 *
 * NEVER include the secret in the event. The lookupId is the only
 * identifier that should appear in the audit row.
 */
describe("Story · API key audit trail builder", () => {
  it("builds a `created` event with lookupId, scopes, expiresAt, actor", async () => {
    const { buildApiKeyAuditEvent } = await import("../../src/core/auth/api-keys/api-key.audit.js");
    const event = buildApiKeyAuditEvent({
      kind: "created",
      lookupId: "00000000-0000-7000-8000-000000000001",
      ownerUserId: "u1",
      scopes: ["read:users", "write:users"],
      expiresAt: 1_700_000_000_000,
      actorUserId: "admin-1",
      tenantId: "t1",
      ipAddress: "10.0.0.1",
      occurredAt: 1_600_000_000_000,
    });

    expect(event.action).toBe("api-key.created");
    expect(event.resource).toBe("ApiKey");
    expect(event.resourceId).toBe("00000000-0000-7000-8000-000000000001");
    expect(event.actorUserId).toBe("admin-1");
    expect(event.tenantId).toBe("t1");
    expect(event.ipAddress).toBe("10.0.0.1");
    expect(event.occurredAt).toBe(1_600_000_000_000);
    expect(event.metadata).toEqual({
      ownerUserId: "u1",
      scopes: ["read:users", "write:users"],
      expiresAt: 1_700_000_000_000,
    });
  });

  it("never serialises the secret into the event metadata", async () => {
    const { buildApiKeyAuditEvent } = await import("../../src/core/auth/api-keys/api-key.audit.js");
    const event = buildApiKeyAuditEvent({
      kind: "created",
      lookupId: "00000000-0000-7000-8000-000000000001",
      ownerUserId: "u1",
      scopes: ["read:users"],
      actorUserId: "admin-1",
      tenantId: "t1",
      ipAddress: "10.0.0.1",
      occurredAt: 1_600_000_000_000,
    });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toMatch(/secret/i);
    expect(serialized).not.toMatch(/nst_pk_/);
  });

  it("builds a `rotated` event referencing both old and new lookupIds", async () => {
    const { buildApiKeyAuditEvent } = await import("../../src/core/auth/api-keys/api-key.audit.js");
    const event = buildApiKeyAuditEvent({
      kind: "rotated",
      lookupId: "00000000-0000-7000-8000-000000000002",
      previousLookupId: "00000000-0000-7000-8000-000000000001",
      ownerUserId: "u1",
      actorUserId: "u1",
      tenantId: "t1",
      ipAddress: "10.0.0.1",
      occurredAt: 1_600_000_000_000,
    });
    expect(event.action).toBe("api-key.rotated");
    expect(event.metadata).toMatchObject({
      previousLookupId: "00000000-0000-7000-8000-000000000001",
      ownerUserId: "u1",
    });
  });

  it("builds a `revoked` event with reason", async () => {
    const { buildApiKeyAuditEvent } = await import("../../src/core/auth/api-keys/api-key.audit.js");
    const event = buildApiKeyAuditEvent({
      kind: "revoked",
      lookupId: "00000000-0000-7000-8000-000000000001",
      reason: "user-requested",
      actorUserId: "admin-1",
      tenantId: "t1",
      ipAddress: "10.0.0.1",
      occurredAt: 1_600_000_000_000,
    });
    expect(event.action).toBe("api-key.revoked");
    expect(event.metadata).toMatchObject({ reason: "user-requested" });
  });

  it("builds a `verified` event for a successful key check", async () => {
    const { buildApiKeyAuditEvent } = await import("../../src/core/auth/api-keys/api-key.audit.js");
    const event = buildApiKeyAuditEvent({
      kind: "verified",
      lookupId: "00000000-0000-7000-8000-000000000001",
      actorUserId: "u1",
      tenantId: "t1",
      ipAddress: "10.0.0.1",
      occurredAt: 1_600_000_000_000,
    });
    expect(event.action).toBe("api-key.verified");
  });

  it("builds a `verify-failed` event with the failure reason", async () => {
    const { buildApiKeyAuditEvent } = await import("../../src/core/auth/api-keys/api-key.audit.js");
    const event = buildApiKeyAuditEvent({
      kind: "verify-failed",
      lookupId: "00000000-0000-7000-8000-000000000001",
      reason: "expired",
      tenantId: "t1",
      ipAddress: "10.0.0.1",
      occurredAt: 1_600_000_000_000,
    });
    expect(event.action).toBe("api-key.verify-failed");
    expect(event.metadata).toMatchObject({ reason: "expired" });
    // verify-failed is anonymous (no actorUserId — the caller is unauthenticated).
    expect(event.actorUserId).toBeUndefined();
  });

  it("rejects malformed lookupId (must be a UUID)", async () => {
    const { buildApiKeyAuditEvent } = await import("../../src/core/auth/api-keys/api-key.audit.js");
    expect(() =>
      buildApiKeyAuditEvent({
        kind: "verified",
        lookupId: "not-a-uuid",
        actorUserId: "u1",
        tenantId: "t1",
        ipAddress: "10.0.0.1",
        occurredAt: 1_600_000_000_000,
      }),
    ).toThrow(/lookupid/i);
  });
});
