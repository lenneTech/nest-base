/**
 * Minimal 5-field cron → millisecond interval for in-process scheduling.
 *
 * BullMQ native `repeat.pattern` accepts full cron expressions when Redis
 * is available; this parser is only used for the in-process fallback.
 */

/**
 * Parse a minimal 5-field cron expression into a millisecond interval.
 *
 * Supports:
 *   "M H * * *" — daily (period = 24h; wall-clock alignment not guaranteed)
 *   "0 * * * *" — hourly
 */
export function parseCronToIntervalMs(cron: string): number | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) {
    return null;
  }

  const [minutePart, hourPart, dayPart, monthPart, weekPart] = parts;

  if (
    minutePart === "0" &&
    hourPart === "*" &&
    dayPart === "*" &&
    monthPart === "*" &&
    weekPart === "*"
  ) {
    return 60 * 60 * 1000;
  }

  const hour = Number.parseInt(hourPart ?? "", 10);
  const minute = Number.parseInt(minutePart ?? "", 10);
  if (
    !Number.isNaN(hour) &&
    !Number.isNaN(minute) &&
    dayPart === "*" &&
    monthPart === "*" &&
    weekPart === "*"
  ) {
    return 24 * 60 * 60 * 1000;
  }

  return null;
}
