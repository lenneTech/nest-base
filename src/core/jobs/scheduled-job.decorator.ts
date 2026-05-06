/**
 * `@ScheduledJob` — metadata-only decorator that marks a class
 * method as a cron-driven job.
 *
 * The pg-boss adapter (`src/core/jobs/`) walks every provider's
 * prototype at module init, reads the captured metadata via
 * `getScheduledJobs(prototype)`, and registers each entry with
 * `pgboss.schedule(name, cron, ...)`. The decorator itself does NOT
 * install a cron watcher — it only records the schedule contract so
 * the adapter can wire it up against the active queue backend.
 *
 * Why metadata-only:
 *   - No side-effects at class-definition time (safe for tests).
 *   - The adapter owns scheduling lifecycle (start / stop / reschedule).
 *   - Cron expressions are validated by pg-boss at schedule time, not
 *     at decorator time, so we don't pull in a cron-parser dependency.
 *
 * Closes:
 *   - CF.JOBS.02 (`@ScheduledJob` cron decorator)
 */

export interface ScheduledJobOptions {
  /** Unique job name within the project. Becomes the pg-boss queue name. */
  readonly name: string;
  /**
   * Standard 5- or 6-field cron expression. Validated lazily by the
   * pg-boss adapter at module init — the decorator does not parse cron.
   */
  readonly cron: string;
}

export interface ScheduledJobMetadata {
  readonly name: string;
  readonly cron: string;
  readonly methodName: string;
}

const SCHEDULED_JOBS_KEY: unique symbol = Symbol.for("nest-base/scheduled-jobs");

interface ScheduledJobCarrier {
  [SCHEDULED_JOBS_KEY]?: ScheduledJobMetadata[];
}

/**
 * Mark a method as a scheduled job. The decorator records the
 * configured name + cron expression on the prototype as metadata
 * for the pg-boss adapter to discover.
 */
export function ScheduledJob(options: ScheduledJobOptions): MethodDecorator {
  if (!options.name || options.name.trim() === "") {
    throw new Error("@ScheduledJob: `name` is required and must not be empty");
  }
  if (!options.cron || options.cron.trim() === "") {
    throw new Error("@ScheduledJob: `cron` expression is required and must not be empty");
  }

  return (target, propertyKey) => {
    const carrier = target as ScheduledJobCarrier;
    const existing = carrier[SCHEDULED_JOBS_KEY] ?? [];
    const entry: ScheduledJobMetadata = {
      name: options.name,
      cron: options.cron,
      methodName: String(propertyKey),
    };
    carrier[SCHEDULED_JOBS_KEY] = [...existing, entry];
  };
}

/**
 * Read the `@ScheduledJob` metadata recorded on a prototype. Used
 * by the pg-boss adapter at module init.
 *
 * Returns an empty array if the class has no decorated methods.
 */
export function getScheduledJobs(prototype: object): ScheduledJobMetadata[] {
  const carrier = prototype as ScheduledJobCarrier;
  return carrier[SCHEDULED_JOBS_KEY] ?? [];
}
