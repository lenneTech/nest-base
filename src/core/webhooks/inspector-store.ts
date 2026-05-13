/**
 * In-memory delivery buffer for the webhook inspector.
 *
 * The dispatcher records into this ring buffer; the React inspector
 * page reads from it via the `/admin/webhooks*.json` endpoints. A
 * bounded buffer is intentional — production webhook deliveries
 * live in Postgres (see `WebhookDelivery` model), but the inspector's
 * dev-mode UX needs predictable, fast in-process lookups without
 * adding a Prisma round-trip per row.
 *
 * Pure data structure: no logging, no I/O, no listeners. The
 * dispatcher is responsible for hooking into outbox events and
 * calling `record()`.
 */

import type { DeliveryAggregateInput, InspectorDeliveryStatus } from "./inspector-aggregates.js";

export interface WebhookInspectorBufferOptions {
  maxRecords?: number;
}

export interface AppendAttemptInput {
  status: InspectorDeliveryStatus;
  statusCode?: number;
  latencyMs?: number;
  errorMessage?: string;
  occurredAt: string;
}

const DEFAULT_MAX = 500;

export class WebhookInspectorBuffer {
  private readonly max: number;
  private records: DeliveryAggregateInput[] = [];

  constructor(options: WebhookInspectorBufferOptions = {}) {
    this.max = Math.max(1, options.maxRecords ?? DEFAULT_MAX);
  }

  record(delivery: DeliveryAggregateInput): void {
    this.records.push({ ...delivery });
    if (this.records.length > this.max) {
      this.records.splice(0, this.records.length - this.max);
    }
  }

  findById(id: string): DeliveryAggregateInput | null {
    const found = this.records.find((r) => r.id === id);
    return found ? { ...found } : null;
  }

  /**
   * Mutate an existing delivery to reflect a new attempt. No-ops if
   * the id is unknown — UI shouldn't break on a stale browser tab
   * that POSTs after the buffer has rolled over.
   */
  appendAttempt(id: string, attempt: AppendAttemptInput): DeliveryAggregateInput | null {
    const idx = this.records.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    const existing = this.records[idx]!;
    const updated: DeliveryAggregateInput = {
      ...existing,
      status: attempt.status,
      attemptCount: existing.attemptCount + 1,
      occurredAt: attempt.occurredAt,
    };
    if (attempt.statusCode !== undefined) updated.statusCode = attempt.statusCode;
    if (attempt.latencyMs !== undefined) updated.latencyMs = attempt.latencyMs;
    if (attempt.errorMessage !== undefined) updated.errorMessage = attempt.errorMessage;
    this.records[idx] = updated;
    return { ...updated };
  }

  recent(): readonly DeliveryAggregateInput[] {
    return Object.freeze([...this.records]);
  }

  /**
   * NIT-2: return only records whose `tenantId` matches the caller's
   * active tenant. Records without a `tenantId` stamp (legacy / demo
   * entries) are included so the inspector works even on setups that
   * don't set the tenant field on every write.
   */
  recentForTenant(tenantId: string): readonly DeliveryAggregateInput[] {
    const filtered = this.records.filter((r) => !r.tenantId || r.tenantId === tenantId);
    return Object.freeze(filtered);
  }

  size(): number {
    return this.records.length;
  }

  clear(): void {
    this.records = [];
  }
}

/**
 * Demo seed used when the buffer is otherwise empty. Pre-populates a
 * mix of endpoints, statuses, and attempt counts so the inspector UI
 * can be navigated end-to-end (sidebar → list → drawer → re-deliver)
 * even on a fresh dev-server restart.
 *
 * Dev-only by intent — production never hits this path because the
 * inspector page itself is gated to `NODE_ENV=development`.
 */
export function buildDemoDeliveries(input: { now: number }): DeliveryAggregateInput[] {
  const { now } = input;
  const minute = 60_000;
  const hour = 60 * minute;
  return [
    {
      id: "demo-1",
      endpointId: "ep-demo-1",
      endpointUrl: "https://example.com/webhooks/customer",
      eventType: "user.created",
      status: "DELIVERED",
      statusCode: 200,
      attemptCount: 1,
      latencyMs: 87,
      occurredAt: new Date(now - 5 * minute).toISOString(),
    },
    {
      id: "demo-2",
      endpointId: "ep-demo-1",
      endpointUrl: "https://example.com/webhooks/customer",
      eventType: "user.updated",
      status: "DELIVERED",
      statusCode: 200,
      attemptCount: 1,
      latencyMs: 102,
      occurredAt: new Date(now - 18 * minute).toISOString(),
    },
    {
      id: "demo-3",
      endpointId: "ep-demo-1",
      endpointUrl: "https://example.com/webhooks/customer",
      eventType: "user.deleted",
      status: "FAILED",
      statusCode: 500,
      attemptCount: 4,
      latencyMs: 1023,
      errorMessage: "Internal Server Error from receiver",
      occurredAt: new Date(now - 47 * minute).toISOString(),
    },
    {
      id: "demo-4",
      endpointId: "ep-demo-2",
      endpointUrl: "https://other.example.com/incoming",
      eventType: "order.placed",
      status: "DELIVERED",
      statusCode: 204,
      attemptCount: 1,
      latencyMs: 156,
      occurredAt: new Date(now - 2 * hour).toISOString(),
    },
    {
      id: "demo-5",
      endpointId: "ep-demo-2",
      endpointUrl: "https://other.example.com/incoming",
      eventType: "order.cancelled",
      status: "FAILED",
      statusCode: 502,
      attemptCount: 3,
      latencyMs: 4500,
      errorMessage: "Bad Gateway",
      occurredAt: new Date(now - 6 * hour).toISOString(),
    },
    {
      id: "demo-6",
      endpointId: "ep-demo-2",
      endpointUrl: "https://other.example.com/incoming",
      eventType: "order.shipped",
      status: "DELIVERED",
      statusCode: 200,
      attemptCount: 2,
      latencyMs: 412,
      occurredAt: new Date(now - 12 * hour).toISOString(),
    },
  ];
}
