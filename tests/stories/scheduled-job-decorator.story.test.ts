import { describe, expect, it } from "vitest";

/**
 * Story · `@ScheduledJob` cron decorator (CF.JOBS.02).
 *
 * The PRD's `CF.JOBS.02` requires a `@ScheduledJob` decorator that
 * marks a class method as a cron-driven job, captured as metadata
 * for the pg-boss adapter to discover at module init.
 *
 * The decorator is metadata-only — it does NOT install a cron
 * watcher itself. The pg-boss adapter (`src/core/jobs/`) reads the
 * registered metadata at boot, registers each entry with
 * `pgboss.schedule(name, cron, ...)`, and the worker process picks
 * them up.
 *
 * Why metadata-only: keeps the decorator side-effect-free, makes
 * unit tests trivial, and lets the adapter run schedules in
 * isolated DB instances per test.
 *
 * Closes:
 *   - CF.JOBS.02 (`@ScheduledJob` cron decorator)
 *
 * Cron expression format: standard 5- or 6-field cron, validated
 * lazily at adapter init (the decorator does not parse cron — it
 * just records the string).
 */
describe("Story · @ScheduledJob cron decorator", () => {
  describe("metadata capture", () => {
    it("records the cron expression on the method", async () => {
      const { ScheduledJob, getScheduledJobs } =
        await import("../../src/core/jobs/scheduled-job.decorator.js");

      class CleanupService {
        @ScheduledJob({ name: "daily-cleanup", cron: "0 3 * * *" })
        runCleanup(): void {
          // method body irrelevant for metadata capture
        }
      }

      const jobs = getScheduledJobs(CleanupService.prototype);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.name).toBe("daily-cleanup");
      expect(jobs[0]?.cron).toBe("0 3 * * *");
      expect(jobs[0]?.methodName).toBe("runCleanup");
    });

    it("supports multiple jobs on the same class", async () => {
      const { ScheduledJob, getScheduledJobs } =
        await import("../../src/core/jobs/scheduled-job.decorator.js");

      class MultiJobService {
        @ScheduledJob({ name: "morning", cron: "0 8 * * *" })
        morningTask(): void {}

        @ScheduledJob({ name: "evening", cron: "0 18 * * *" })
        eveningTask(): void {}
      }

      const jobs = getScheduledJobs(MultiJobService.prototype);
      expect(jobs).toHaveLength(2);
      const names = jobs.map((j) => j.name).sort();
      expect(names).toEqual(["evening", "morning"]);
    });

    it("preserves the original method body (decorator is non-destructive)", async () => {
      const { ScheduledJob } = await import("../../src/core/jobs/scheduled-job.decorator.js");

      class TaskService {
        @ScheduledJob({ name: "double", cron: "* * * * *" })
        double(n: number): number {
          return n * 2;
        }
      }

      const svc = new TaskService();
      expect(svc.double(7)).toBe(14);
    });

    it("returns an empty list for classes without any decorated methods", async () => {
      const { getScheduledJobs } = await import("../../src/core/jobs/scheduled-job.decorator.js");

      class PlainService {
        doNothing(): void {}
      }

      expect(getScheduledJobs(PlainService.prototype)).toEqual([]);
    });
  });

  describe("validation", () => {
    it("rejects an empty job name", async () => {
      const { ScheduledJob } = await import("../../src/core/jobs/scheduled-job.decorator.js");

      expect(() => {
        class _BadService {
          // The decorator should throw at definition time on empty name.
          @ScheduledJob({ name: "", cron: "* * * * *" })
          run(): void {}
        }
        return _BadService;
      }).toThrow(/name/i);
    });

    it("rejects an empty cron expression", async () => {
      const { ScheduledJob } = await import("../../src/core/jobs/scheduled-job.decorator.js");

      expect(() => {
        class _BadService {
          @ScheduledJob({ name: "x", cron: "" })
          run(): void {}
        }
        return _BadService;
      }).toThrow(/cron/i);
    });
  });
});
