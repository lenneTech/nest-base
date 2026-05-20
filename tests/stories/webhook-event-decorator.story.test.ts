import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  WebhookEvent,
  getRegisteredWebhookEvents,
  getWebhookEventMetadata,
  resetWebhookEventRegistryForTests,
} from "../../src/core/webhooks/webhook-event.decorator.js";

/**
 * Story · `@WebhookEvent` decorator + registry (CF.WEBHOOK.04).
 *
 * The PRD requires "Webhook event registry + @WebhookEvent
 * decorator + secret format". The decorator records name +
 * description + version on the class' prototype + into a
 * process-wide registry the dispatcher / Audit Browser /
 * `/hub/webhooks` catalogue read from.
 *
 * Validation surface:
 *   - `name` required + non-empty
 *   - `name` matches `<resource>.<action>` (lowercase, dot-separated)
 *   - `description` non-empty when provided
 *   - `version` is a positive integer when provided
 *   - duplicate names on different classes throw at decoration time
 */
describe("Story · @WebhookEvent decorator", () => {
  beforeEach(() => {
    resetWebhookEventRegistryForTests();
  });
  afterEach(() => {
    resetWebhookEventRegistryForTests();
  });

  describe("happy path", () => {
    it("attaches metadata to the class + registers it globally", () => {
      @WebhookEvent({ name: "user.created", description: "Fires after sign-up." })
      class UserCreated {}
      const meta = getWebhookEventMetadata(UserCreated);
      expect(meta).toBeDefined();
      expect(meta?.name).toBe("user.created");
      expect(meta?.description).toBe("Fires after sign-up.");
      expect(meta?.version).toBe(1);
      expect(getRegisteredWebhookEvents()).toHaveLength(1);
      expect(getRegisteredWebhookEvents()[0]?.name).toBe("user.created");
    });

    it("defaults version to 1 when omitted", () => {
      @WebhookEvent({ name: "subscription.cancelled" })
      class Cancelled {}
      const meta = getWebhookEventMetadata(Cancelled);
      expect(meta?.version).toBe(1);
    });

    it("records explicit version + description", () => {
      @WebhookEvent({
        name: "tenant.member.invited",
        description: "Fires on org-plugin invite send",
        version: 3,
      })
      class Invited {}
      const meta = getWebhookEventMetadata(Invited);
      expect(meta?.version).toBe(3);
      expect(meta?.description).toBe("Fires on org-plugin invite send");
    });
  });

  describe("name validation", () => {
    it("rejects empty / whitespace name", () => {
      expect(() => WebhookEvent({ name: "" })).toThrow(/required/);
      expect(() => WebhookEvent({ name: "   " })).toThrow(/required/);
    });

    it("rejects non-conforming names (uppercase, no dot, leading/trailing dot)", () => {
      expect(() => WebhookEvent({ name: "User.Created" })).toThrow(/<resource>\.<action>/);
      expect(() => WebhookEvent({ name: "userCreated" })).toThrow(/<resource>\.<action>/);
      expect(() => WebhookEvent({ name: ".created" })).toThrow(/<resource>\.<action>/);
      expect(() => WebhookEvent({ name: "user." })).toThrow(/<resource>\.<action>/);
      // Empty segment in the middle.
      expect(() => WebhookEvent({ name: "user..created" })).toThrow(/<resource>\.<action>/);
    });

    it("accepts hierarchical names with multiple dots (resource.subresource.action)", () => {
      const decorator = WebhookEvent({ name: "tenant.member.invited" });
      class A {}
      decorator(A);
      expect(getWebhookEventMetadata(A)?.name).toBe("tenant.member.invited");
    });

    it("accepts snake_case segments", () => {
      const decorator = WebhookEvent({ name: "auth_session.expired" });
      class A {}
      decorator(A);
      expect(getWebhookEventMetadata(A)?.name).toBe("auth_session.expired");
    });
  });

  describe("description validation", () => {
    it("rejects empty-string description (must be omitted, not blank)", () => {
      expect(() => WebhookEvent({ name: "x.y", description: "" })).toThrow(/non-empty/);
      expect(() => WebhookEvent({ name: "x.y", description: "   " })).toThrow(/non-empty/);
    });

    it("defaults to '' when omitted (not displayed in catalogue)", () => {
      @WebhookEvent({ name: "ping.tick" })
      class Tick {}
      expect(getWebhookEventMetadata(Tick)?.description).toBe("");
    });
  });

  describe("version validation", () => {
    it("rejects non-positive / non-integer versions", () => {
      expect(() => WebhookEvent({ name: "x.y", version: 0 })).toThrow(/positive integer/);
      expect(() => WebhookEvent({ name: "x.y", version: -1 })).toThrow(/positive integer/);
      expect(() => WebhookEvent({ name: "x.y", version: 1.5 })).toThrow(/positive integer/);
    });
  });

  describe("registry semantics", () => {
    it("rejects duplicate event names on different classes", () => {
      const decorate = WebhookEvent({ name: "user.created" });
      class A {}
      class B {}
      decorate(A);
      expect(() => decorate(B)).toThrow(/duplicate event name/);
    });

    it("re-registering the SAME class is idempotent (no throw)", () => {
      class A {}
      const decorate = WebhookEvent({ name: "user.created" });
      decorate(A);
      // Re-running the same decorator on the same class is a tooling
      // edge case (hot reload) — should not throw.
      expect(() => decorate(A)).not.toThrow();
    });

    it("getRegisteredWebhookEvents returns events sorted by name", () => {
      @WebhookEvent({ name: "z.last" })
      class Z {}
      @WebhookEvent({ name: "a.first" })
      class A {}
      @WebhookEvent({ name: "m.middle" })
      class M {}
      void Z;
      void A;
      void M;
      const events = getRegisteredWebhookEvents();
      expect(events.map((e) => e.name)).toEqual(["a.first", "m.middle", "z.last"]);
    });

    it("getRegisteredWebhookEvents returns an immutable snapshot", () => {
      @WebhookEvent({ name: "x.y" })
      class X {}
      void X;
      const snapshot = getRegisteredWebhookEvents();
      // Mutating the returned array does not affect subsequent calls.
      const before = snapshot.length;
      // The cast to a writable array proves the snapshot semantics —
      // a real mutation here mustn't affect subsequent reads.
      (snapshot as WebhookEventMetadataMutable[]).push({
        name: "fake.event",
        description: "",
        version: 1,
        target: {},
      });
      const after = getRegisteredWebhookEvents().length;
      expect(after).toBe(before);
    });
  });
});

interface WebhookEventMetadataMutable {
  name: string;
  description: string;
  version: number;
  target: object;
}
