import { describe, expect, it } from "vitest";

import { mapInspectorDeliveryRow } from "../../src/core/webhooks/inspector-deliveries-loader.js";

describe("Story · webhook inspector deliveries loader", () => {
  it("maps a Postgres row to DeliveryAggregateInput", () => {
    const aggregate = mapInspectorDeliveryRow({
      id: "01900000-0000-7000-8000-000000000001",
      endpoint_id: "01900000-0000-7000-8000-000000000002",
      endpoint_url: "https://hooks.example.com/in",
      tenant_id: "11111111-1111-1111-1111-111111111111",
      event_id: "01900000-0000-7000-8000-000000000003",
      event_type: "user.signup",
      status: "DELIVERED",
      status_code: 200,
      attempt_count: 2,
      last_error: null,
      is_test: false,
      occurred_at: new Date("2026-01-15T12:00:00Z"),
    });

    expect(aggregate.id).toBe("01900000-0000-7000-8000-000000000001");
    expect(aggregate.endpointUrl).toBe("https://hooks.example.com/in");
    expect(aggregate.eventType).toBe("user.signup");
    expect(aggregate.status).toBe("DELIVERED");
    expect(aggregate.attemptCount).toBe(2);
  });
});
