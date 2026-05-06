import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");
const SCHEMA = readFileSync(resolve(ROOT, "prisma/schema.prisma"), "utf8");

function blockOf(model: string): string {
  const re = new RegExp(`model\\s+${model}\\s*\\{[\\s\\S]*?\\n\\}`, "m");
  const match = SCHEMA.match(re);
  expect(match, `model ${model} not found`).not.toBeNull();
  return match![0];
}

/**
 * Webhook persistence schema.
 *
 * Two models cover the deliver-and-track surface:
 *   - WebhookEndpoint: subscriber config (URL, secret, events, status,
 *     consecutiveFailures for the auto-disable gate)
 *   - WebhookDelivery: per-attempt audit row (endpoint, event, status,
 *     statusCode, attemptCount, nextRetryAt)
 */
describe("Webhook persistence schema", () => {
  describe("WebhookEndpointStatus enum", () => {
    it("declares ACTIVE + DISABLED", () => {
      expect(SCHEMA).toMatch(
        /enum\s+WebhookEndpointStatus\s*\{[\s\S]*ACTIVE[\s\S]*DISABLED[\s\S]*\}/,
      );
    });
  });

  describe("WebhookDeliveryStatus enum", () => {
    it("declares PENDING + DELIVERED + FAILED", () => {
      expect(SCHEMA).toMatch(
        /enum\s+WebhookDeliveryStatus\s*\{[\s\S]*PENDING[\s\S]*DELIVERED[\s\S]*FAILED[\s\S]*\}/,
      );
    });
  });

  describe("WebhookEndpoint model", () => {
    const block = (): string => blockOf("WebhookEndpoint");

    it("maps to `webhook_endpoints` with snake_case columns", () => {
      const b = block();
      expect(b).toMatch(/@@map\(\s*"webhook_endpoints"\s*\)/);
      expect(b).toMatch(/tenantId[\s\S]*@map\(\s*"tenant_id"\s*\)/);
    });

    it("carries url + secret + events[] + status + consecutiveFailures", () => {
      const b = block();
      expect(b).toMatch(/url\s+String/);
      expect(b).toMatch(/secret\s+String/);
      expect(b).toMatch(/events\s+String\[\]/);
      expect(b).toMatch(/status\s+WebhookEndpointStatus/);
      expect(b).toMatch(/consecutiveFailures[\s\S]*@map\(\s*"consecutive_failures"\s*\)/);
    });

    it("carries tenantId column scoped to a tenant", () => {
      // After issue #118 the FK to the legacy Tenant table is removed;
      // tenantId is a plain column (no Prisma relation) — isolation is
      // enforced via RLS at the Postgres layer.
      expect(block()).toMatch(/tenantId[\s\S]*@map\(\s*"tenant_id"\s*\)/);
    });

    it("exposes deliveries[] back-relation to WebhookDelivery", () => {
      expect(block()).toMatch(/deliveries\s+WebhookDelivery\[\]/);
    });
  });

  describe("WebhookDelivery model", () => {
    const block = (): string => blockOf("WebhookDelivery");

    it("maps to `webhook_deliveries` with snake_case columns", () => {
      const b = block();
      expect(b).toMatch(/@@map\(\s*"webhook_deliveries"\s*\)/);
      expect(b).toMatch(/endpointId[\s\S]*@map\(\s*"endpoint_id"\s*\)/);
      expect(b).toMatch(/eventId[\s\S]*@map\(\s*"event_id"\s*\)/);
    });

    it("tracks status + statusCode + attemptCount + nextRetryAt", () => {
      const b = block();
      expect(b).toMatch(/status\s+WebhookDeliveryStatus/);
      expect(b).toMatch(/statusCode[\s\S]*@map\(\s*"status_code"\s*\)/);
      expect(b).toMatch(/attemptCount[\s\S]*@map\(\s*"attempt_count"\s*\)/);
      expect(b).toMatch(/nextRetryAt[\s\S]*@map\(\s*"next_retry_at"\s*\)/);
    });

    it("cascades on endpoint delete", () => {
      expect(block()).toMatch(/endpoint\s+WebhookEndpoint\s+@relation\([\s\S]*onDelete:\s*Cascade/);
    });
  });

  describe("Organization relation", () => {
    it("Organization model exists (canonical tenant layer — issue #118)", () => {
      // The legacy Tenant model is removed; Organization is the BA canonical table.
      expect(blockOf("Organization")).toMatch(/@@map\(\s*"organization"\s*\)/);
    });
  });
});
