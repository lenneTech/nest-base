/**
 * Pure planners for `/hub/dashboard.json` chart buckets.
 *
 * Given aggregated DB rows, builds the shapes the React dashboard
 * consumes. No I/O — testable without NestJS.
 */

export interface SessionHourRow {
  hourStart: Date;
  newLogins: number;
  active: number;
}

export interface SessionChartBucket {
  hour: string;
  active: number;
  newLogins: number;
}

/**
 * Build 24 hourly session buckets (oldest → newest) from sparse SQL
 * aggregates. Missing hours are zero-filled.
 */
export function buildSessionChartBuckets(
  rows: readonly SessionHourRow[],
  nowMs: number = Date.now(),
): SessionChartBucket[] {
  const byHour = new Map<number, SessionHourRow>();
  for (const row of rows) {
    byHour.set(row.hourStart.getTime(), row);
  }

  const buckets: SessionChartBucket[] = [];
  for (let i = 23; i >= 0; i--) {
    const hourStart = new Date(nowMs - i * 60 * 60 * 1000);
    hourStart.setMinutes(0, 0, 0);
    const row = byHour.get(hourStart.getTime());
    buckets.push({
      hour: hourStart.toISOString().slice(11, 13) + ":00",
      active: row?.active ?? 0,
      newLogins: row?.newLogins ?? 0,
    });
  }
  return buckets;
}

/**
 * Compute webhook success rate in [0, 1] from delivery status counts.
 * Returns `null` when there were no deliveries in the window.
 */
export function computeWebhookSuccessRate(input: {
  delivered: number;
  failed: number;
  pending: number;
}): number | null {
  const total = input.delivered + input.failed + input.pending;
  if (total === 0) return null;
  return input.delivered / total;
}
