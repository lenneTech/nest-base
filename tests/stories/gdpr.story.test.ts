import { describe, expect, it } from "vitest";

import {
  GdprExportEmptyError,
  buildGdprExport,
  planGdprErasure,
  type GdprErasureMode,
  type GdprExportInput,
  type GdprPiiField,
} from "../../src/core/gdpr/gdpr.service.js";

/**
 * Story · GDPR endpoints.
 *
 * Two pure functions cover the GDPR surface, the controllers stay
 * thin:
 *
 *   - buildGdprExport — `/me/export` payload (Article 20 — right to
 *     data portability). Bundles the user record, every related
 *     resource list the caller hands in, and a metadata header so
 *     the export is self-describing.
 *
 *   - planGdprErasure — `/me/account` deletion (Article 17 — right
 *     to erasure). Two modes:
 *       * `hard-delete`   — the user has no audit-relevant tail and
 *                           can simply be removed.
 *       * `anonymise`     — audit / billing / consent records keep
 *                           pointing to the user; PII fields get
 *                           replaced with deterministic hashes so
 *                           re-identification is impossible while
 *                           the FK graph stays intact.
 *
 * The controller picks the mode (project policy) and applies the
 * planned operations through Prisma.
 */
describe("Story · GDPR", () => {
  function exportInput(overrides: Partial<GdprExportInput> = {}): GdprExportInput {
    return {
      user: { id: "u-1", email: "jane@example.com", name: "Jane" },
      relatedResources: { Project: [{ id: "p-1", name: "Plan" }] },
      now: () => Date.parse("2026-04-28T12:00:00Z"),
      ...overrides,
    };
  }

  describe("buildGdprExport()", () => {
    it('emits a `kind: "gdpr-export"` envelope so consumers can pin the schema', () => {
      const out = buildGdprExport(exportInput());
      expect(out.kind).toBe("gdpr-export");
      expect(out.version).toBe(1);
    });

    it("embeds the user record verbatim", () => {
      const out = buildGdprExport(exportInput());
      expect(out.user).toEqual({ id: "u-1", email: "jane@example.com", name: "Jane" });
    });

    it("embeds every related-resource bundle", () => {
      const out = buildGdprExport(
        exportInput({
          relatedResources: {
            Project: [{ id: "p-1" }, { id: "p-2" }],
            Order: [{ id: "o-1" }],
          },
        }),
      );
      expect(out.relatedResources.Project).toHaveLength(2);
      expect(out.relatedResources.Order).toEqual([{ id: "o-1" }]);
    });

    it("records the export timestamp as ISO so a downloaded archive is dated", () => {
      const out = buildGdprExport(exportInput({ now: () => Date.parse("2026-05-01T08:30:00Z") }));
      expect(out.exportedAt).toBe("2026-05-01T08:30:00.000Z");
    });

    it("rejects an empty user record (footgun guard)", () => {
      expect(() => buildGdprExport(exportInput({ user: undefined as never }))).toThrow(
        GdprExportEmptyError,
      );
    });
  });

  describe("planGdprErasure()", () => {
    function piiFields(): GdprPiiField[] {
      return [
        { name: "email", strategy: "hash" },
        { name: "name", strategy: "null" },
        { name: "phone", strategy: "mask" },
      ];
    }

    it("hard-delete returns a single delete operation", () => {
      const plan = planGdprErasure({
        userId: "u-1",
        mode: "hard-delete",
        piiFields: piiFields(),
      });
      expect(plan.operations).toEqual([{ type: "delete", userId: "u-1" }]);
    });

    it("anonymise emits one update with a substitute value per PII field", () => {
      const plan = planGdprErasure({
        userId: "u-1",
        mode: "anonymise",
        piiFields: piiFields(),
      });
      expect(plan.operations).toHaveLength(1);
      const op = plan.operations[0]!;
      expect(op).toMatchObject({ type: "update", userId: "u-1" });
      const updates = (op as { type: "update"; updates: Record<string, string | null> }).updates;
      expect(updates).toMatchObject({
        email: expect.stringMatching(/^anon-[0-9a-f]{16}@anonymous\.invalid$/),
        name: null,
        phone: "***",
      });
    });

    it("anonymise email is deterministic per userId (same input, same hash)", () => {
      const a = planGdprErasure({ userId: "u-1", mode: "anonymise", piiFields: piiFields() });
      const b = planGdprErasure({ userId: "u-1", mode: "anonymise", piiFields: piiFields() });
      const aEmail = (a.operations[0] as unknown as { updates: { email: string } }).updates.email;
      const bEmail = (b.operations[0] as unknown as { updates: { email: string } }).updates.email;
      expect(aEmail).toBe(bEmail);
    });

    it("anonymise hashes differ across users (no collision)", () => {
      const a = planGdprErasure({ userId: "u-1", mode: "anonymise", piiFields: piiFields() });
      const b = planGdprErasure({ userId: "u-2", mode: "anonymise", piiFields: piiFields() });
      const aEmail = (a.operations[0] as unknown as { updates: { email: string } }).updates.email;
      const bEmail = (b.operations[0] as unknown as { updates: { email: string } }).updates.email;
      expect(aEmail).not.toBe(bEmail);
    });

    it("rejects an unknown erasure mode", () => {
      expect(() =>
        planGdprErasure({
          userId: "u-1",
          mode: "unknown" as GdprErasureMode,
          piiFields: piiFields(),
        }),
      ).toThrow(/mode/i);
    });

    it("rejects empty userId", () => {
      expect(() =>
        planGdprErasure({ userId: "", mode: "hard-delete", piiFields: piiFields() }),
      ).toThrow(/userId/i);
    });

    it("anonymise with an empty piiFields list is rejected (degenerate config)", () => {
      expect(() => planGdprErasure({ userId: "u-1", mode: "anonymise", piiFields: [] })).toThrow(
        /piiFields/i,
      );
    });
  });
});
