/**
 * In-memory delivery buffer for the webhook inspector.
 *
 * The dispatcher records into this ring buffer; the React inspector
 * page reads from it via the `/hub/admin/webhooks*.json` endpoints. A
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
