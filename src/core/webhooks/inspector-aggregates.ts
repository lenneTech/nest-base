/**
 * Pure planners for the `/admin/webhooks` inspector page.
 *
 * Aggregations (count by status, p95 latency, failure rate, sparklines)
 * and the filter-DSL operate on plain delivery records. The dispatcher's
 * persistence layer owns reading from Postgres and converting rows into
 * `DeliveryAggregateInput[]`; this module is I/O-free so the inspector
 * UI can evolve without booting NestJS in the unit suite.
 */

export type InspectorDeliveryStatus = "DELIVERED" | "FAILED" | "PENDING";

export interface DeliveryAggregateInput {
  id: string;
  endpointId: string;
  endpointUrl: string;
  eventType?: string;
  status: InspectorDeliveryStatus;
  statusCode?: number;
  attemptCount: number;
  /** Round-trip latency for the most recent attempt, in ms. */
  latencyMs?: number;
  /** ISO-8601 timestamp; older records are excluded by the window. */
  occurredAt: string;
  errorMessage?: string;
  /**
   * NIT-2: tenant that owns this delivery. Used to filter the buffer
   * per-tenant when reading from the inspector endpoint so admins only
   * see deliveries for their own organization.
   */
  tenantId?: string;
  /**
   * True for deliveries triggered via the inspector "Send test event"
   * button. Test deliveries are visible in the list (when the toggle
   * is on) but excluded from aggregate metrics so they don't skew
   * production failure-rate or p95-latency calculations.
   */
  isTest?: boolean;
}

export interface EndpointAggregate {
  endpointId: string;
  endpointUrl: string;
  total: number;
  delivered: number;
  failed: number;
  pending: number;
  /** 95th-percentile latency across delivered attempts in the window, ms. */
  p95LatencyMs: number;
  /** Failed / total over the window. 0 when total === 0. */
  failureRate: number;
  /** ISO-8601 timestamp of the most recent record (any status). */
  lastSeenAt?: string;
}

export interface BuildEndpointAggregatesInput {
  deliveries: readonly DeliveryAggregateInput[];
  /** Window end (epoch-ms). Records older than `now - windowMs` are dropped. */
  now: number;
  /** Aggregation window (ms). 24h is the default the React page renders. */
  windowMs: number;
}

/**
 * Group deliveries per endpoint and compute count + p95 + failure-rate.
 * Sorted by total desc so the React sidebar shows hot endpoints first.
 */
export function buildEndpointAggregates(input: BuildEndpointAggregatesInput): EndpointAggregate[] {
  const cutoff = input.now - input.windowMs;
  const buckets = new Map<string, DeliveryAggregateInput[]>();

  for (const record of input.deliveries) {
    const ts = Date.parse(record.occurredAt);
    if (!Number.isFinite(ts)) continue;
    if (ts < cutoff) continue;
    const list = buckets.get(record.endpointId);
    if (list) {
      list.push(record);
    } else {
      buckets.set(record.endpointId, [record]);
    }
  }

  const result: EndpointAggregate[] = [];
  for (const [endpointId, records] of buckets) {
    // The endpointUrl shown in the sidebar follows the latest record so
    // a URL change after a redeploy is reflected in the UI without a
    // separate fetch of the endpoint table.
    const sortedByTime = [...records].sort(
      (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
    );
    const latest = sortedByTime[0]!;

    let delivered = 0;
    let failed = 0;
    let pending = 0;
    const deliveredLatencies: number[] = [];
    // Exclude test deliveries from aggregate metrics — they are inspector
    // health-checks and should not inflate failure-rate or p95 latency.
    const productionRecords = records.filter((r) => !r.isTest);
    for (const r of productionRecords) {
      if (r.status === "DELIVERED") {
        delivered += 1;
        if (typeof r.latencyMs === "number" && r.latencyMs >= 0) {
          deliveredLatencies.push(r.latencyMs);
        }
      } else if (r.status === "FAILED") {
        failed += 1;
      } else {
        pending += 1;
      }
    }

    const total = productionRecords.length;
    result.push({
      endpointId,
      endpointUrl: latest.endpointUrl,
      total,
      delivered,
      failed,
      pending,
      p95LatencyMs: percentile(deliveredLatencies, 0.95),
      failureRate: total === 0 ? 0 : failed / total,
      lastSeenAt: latest.occurredAt,
    });
  }

  result.sort((a, b) => b.total - a.total);
  return result;
}

export interface BuildSparklineInput {
  deliveries: readonly DeliveryAggregateInput[];
  /** Window end (epoch-ms). */
  now: number;
  /** Number of buckets to emit. */
  bucketCount: number;
  /** Width of each bucket in ms. */
  bucketMs: number;
}

/**
 * Histogram of deliveries per time bucket, oldest → newest. The React
 * sidebar renders these as a 24-bar sparkline (24 hours, one bucket
 * per hour). Records outside the window are silently dropped.
 */
export function buildSparkline(input: BuildSparklineInput): number[] {
  const buckets: number[] = Array.from({ length: input.bucketCount }, () => 0);
  const windowStart = input.now - input.bucketCount * input.bucketMs;
  for (const record of input.deliveries) {
    const ts = Date.parse(record.occurredAt);
    if (!Number.isFinite(ts)) continue;
    if (ts < windowStart || ts > input.now) continue;
    const offset = input.now - ts;
    // Bucket index counts down from the latest (rightmost) bucket so
    // the result reads left-to-right oldest → newest.
    const idxFromEnd = Math.floor(offset / input.bucketMs);
    const idx = input.bucketCount - 1 - idxFromEnd;
    if (idx >= 0 && idx < input.bucketCount) buckets[idx] += 1;
  }
  return buckets;
}

export interface DeliveryFilterInput {
  deliveries: readonly DeliveryAggregateInput[];
  endpointId?: string;
  status?: InspectorDeliveryStatus | "ALL";
  eventType?: string;
  /** ISO-8601, inclusive lower bound on `occurredAt`. */
  from?: string;
  /** ISO-8601, inclusive upper bound on `occurredAt`. */
  to?: string;
  /** Substring search over `id` (case-insensitive). Empty string is no filter. */
  search?: string;
}

/**
 * Apply the inspector's filter DSL to a delivery list. Pure & total —
 * unknown values fall back to "no filter" rather than throwing so a
 * stale URL parameter in the browser never breaks the page.
 */
export function filterDeliveries(input: DeliveryFilterInput): DeliveryAggregateInput[] {
  const fromTs = input.from ? Date.parse(input.from) : Number.NEGATIVE_INFINITY;
  const toTs = input.to ? Date.parse(input.to) : Number.POSITIVE_INFINITY;
  const search = (input.search ?? "").trim().toLowerCase();
  const status = input.status === "ALL" ? undefined : input.status;

  return input.deliveries.filter((record) => {
    if (input.endpointId && record.endpointId !== input.endpointId) return false;
    if (status && record.status !== status) return false;
    if (input.eventType && record.eventType !== input.eventType) return false;

    const ts = Date.parse(record.occurredAt);
    if (Number.isFinite(ts)) {
      if (Number.isFinite(fromTs) && ts < fromTs) return false;
      if (Number.isFinite(toTs) && ts > toTs) return false;
    }

    if (search.length > 0 && !record.id.toLowerCase().includes(search)) return false;
    return true;
  });
}

/**
 * Linear-interpolation percentile (Excel-style PERCENTILE.INC). Returns
 * 0 for an empty input so the React sidebar can render a "—" fallback
 * without checking length.
 */
function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const rank = (sorted.length - 1) * p;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low]!;
  const fraction = rank - low;
  return sorted[low]! + (sorted[high]! - sorted[low]!) * fraction;
}
