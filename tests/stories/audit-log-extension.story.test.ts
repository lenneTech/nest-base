import { describe, expect, it } from "vitest";

import {
  AuditLogActionUnknownError,
  buildAuditLogEntry,
  type AuditLogInput,
} from "../../src/core/audit/audit-log.service.js";

/**
 * Story · Audit-Log-Extension with encryption-awareness
 *.
 *
 * The audit log records every CRUD on every covered resource so an
 * admin can replay "who changed what when". The Audit-Browser UI
 * reads exactly this shape (`tests/stories/audit-browser-ui.story.test.ts`).
 *
 * Encryption-awareness: when the calling service marks a field as
 * encrypted (project-level field-encryption is opt-in via
 * `features.fieldEncryption`), the audit log MUST NOT store the
 * plaintext. The builder masks the value with the literal
 * `[encrypted]` placeholder so a leaked audit row exposes only the
 * fact that the field changed, not what it changed to.
 */
describe("Story · Audit-Log-Extension", () => {
  function input(overrides: Partial<AuditLogInput> = {}): AuditLogInput {
    return {
      action: "update",
      resource: "Project",
      resourceId: "p-1",
      actorUserId: "u-1",
      tenantId: "t-1",
      now: () => Date.parse("2026-04-28T12:00:00Z"),
      before: { name: "old", notes: "plain" },
      after: { name: "new", notes: "plain" },
      encryptedFields: [],
      ...overrides,
    };
  }

  describe("top-level shape", () => {
    it("emits the entry envelope (id, action, resource, resourceId, actor, occurredAt)", () => {
      const entry = buildAuditLogEntry(input());
      expect(entry.action).toBe("update");
      expect(entry.resource).toBe("Project");
      expect(entry.resourceId).toBe("p-1");
      expect(entry.actorUserId).toBe("u-1");
      expect(entry.tenantId).toBe("t-1");
    });

    it("records the timestamp as ISO so the Audit-Browser can render it directly", () => {
      const entry = buildAuditLogEntry(input({ now: () => Date.parse("2026-05-01T08:30:00Z") }));
      expect(entry.occurredAt).toBe("2026-05-01T08:30:00.000Z");
    });

    it("rejects an unknown action (footgun guard)", () => {
      expect(() => buildAuditLogEntry(input({ action: "frobnicate" as never }))).toThrow(
        AuditLogActionUnknownError,
      );
    });
  });

  describe("action-specific payload", () => {
    it("create entries carry only `after` (no before)", () => {
      const entry = buildAuditLogEntry(
        input({ action: "create", before: undefined, after: { id: "p-1", name: "new" } }),
      );
      expect(entry.before).toBeUndefined();
      expect(entry.after).toEqual({ id: "p-1", name: "new" });
    });

    it("delete entries carry only `before` (no after)", () => {
      const entry = buildAuditLogEntry(
        input({ action: "delete", before: { id: "p-1", name: "gone" }, after: undefined }),
      );
      expect(entry.before).toEqual({ id: "p-1", name: "gone" });
      expect(entry.after).toBeUndefined();
    });

    it("update entries carry both halves", () => {
      const entry = buildAuditLogEntry(input());
      expect(entry.before).toEqual({ name: "old", notes: "plain" });
      expect(entry.after).toEqual({ name: "new", notes: "plain" });
    });
  });

  describe("encryption awareness", () => {
    it("masks encrypted fields in `before` with [encrypted]", () => {
      const entry = buildAuditLogEntry(
        input({
          before: { name: "old", secret: "plaintext-secret" },
          after: { name: "new", secret: "plaintext-secret" },
          encryptedFields: ["secret"],
        }),
      );
      expect(entry.before?.secret).toBe("[encrypted]");
    });

    it("masks encrypted fields in `after`", () => {
      const entry = buildAuditLogEntry(
        input({
          before: { name: "old", secret: "plaintext-secret" },
          after: { name: "new", secret: "updated-secret" },
          encryptedFields: ["secret"],
        }),
      );
      expect(entry.after?.secret).toBe("[encrypted]");
    });

    it("keeps non-encrypted fields verbatim while masking encrypted ones", () => {
      const entry = buildAuditLogEntry(
        input({
          before: { name: "old", token: "tok-old" },
          after: { name: "new", token: "tok-new" },
          encryptedFields: ["token"],
        }),
      );
      expect(entry.before?.name).toBe("old");
      expect(entry.after?.name).toBe("new");
      expect(entry.before?.token).toBe("[encrypted]");
      expect(entry.after?.token).toBe("[encrypted]");
    });

    it("masks even if the encrypted field is absent in one half (deleted/added)", () => {
      const entry = buildAuditLogEntry(
        input({
          action: "update",
          before: { name: "old" },
          after: { name: "new", secret: "just-added" },
          encryptedFields: ["secret"],
        }),
      );
      expect(entry.before?.secret).toBeUndefined();
      expect(entry.after?.secret).toBe("[encrypted]");
    });

    it("does nothing when encryptedFields is empty", () => {
      const entry = buildAuditLogEntry(
        input({
          before: { secret: "plain1" },
          after: { secret: "plain2" },
          encryptedFields: [],
        }),
      );
      expect(entry.before?.secret).toBe("plain1");
      expect(entry.after?.secret).toBe("plain2");
    });
  });

  describe("determinism", () => {
    it("returns byte-identical entries for byte-identical inputs", () => {
      expect(JSON.stringify(buildAuditLogEntry(input()))).toBe(
        JSON.stringify(buildAuditLogEntry(input())),
      );
    });
  });
});
