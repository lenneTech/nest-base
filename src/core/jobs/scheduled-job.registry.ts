import { Inject, Injectable, Logger, NotFoundException, type OnApplicationBootstrap } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";

import { getScheduledJobs } from "./scheduled-job.decorator.js";

/**
 * `ScheduledJobRegistry` — runtime discovery surface for every
 * `@ScheduledJob`-decorated method in the app (CF.JOBS.02).
 *
 * The decorator is metadata-only by design (iter-31 contract); this
 * registry is what turns it into runtime cron. At
 * `OnApplicationBootstrap` we walk every Nest provider via
 * `DiscoveryService.getProviders()`, read the captured
 * `@ScheduledJob` metadata from each prototype, and bind a
 * `() => provider.method.call(provider)` closure into a name → entry
 * map.
 *
 * Two consumers of the registry live in the codebase today:
 *  - `GET /dev/scheduled-jobs.json` (dev portal) — surfaces the
 *    inventory so an operator sees which crons are active without
 *    grepping the source.
 *  - `runOnce(name)` — drives any registered tick under test (the
 *    e2e harness uses this to assert apiKeyExpiry / gdprErasure
 *    side-effects without waiting on real cron).
 *
 * A BullMQ-backed adapter can iterate the same registry and call
 * `queue.add(entry.name, {}, { repeat: { cron: entry.cron } })` per
 * entry. The registry's shape is the contract that adapter consumes.
 */

export interface ScheduledJobEntry {
  /** Unique job name (used as the BullMQ queue / job name). */
  readonly name: string;
  /** Standard 5-field cron expression (validated lazily by the cron driver). */
  readonly cron: string;
  /** Friendly identifier — `<ClassName>.<methodName>` — useful for /dev hub. */
  readonly source: string;
  /** Bound closure that invokes the decorated method on its instance. */
  readonly run: () => Promise<unknown>;
}

export const SCHEDULED_JOB_REGISTRY = Symbol.for("lt:ScheduledJobRegistry");

/**
 * Thrown when `runOnce(name)` is called with an unknown job name.
 * Extends `NotFoundException` so the ProblemDetails filter maps it to
 * HTTP 404 automatically when it escapes a controller (Fix #20).
 */
export class ScheduledJobNotFoundError extends NotFoundException {
  constructor(name: string) {
    super(`scheduled job "${name}" not found`);
    this.name = "ScheduledJobNotFoundError";
  }
}

export interface ScheduledJobRegistry {
  list(): readonly ScheduledJobEntry[];
  runOnce(name: string): Promise<unknown>;
  has(name: string): boolean;
}

@Injectable()
export class DiscoveryScheduledJobRegistry implements ScheduledJobRegistry, OnApplicationBootstrap {
  private readonly log = new Logger("ScheduledJobRegistry");
  private readonly entries = new Map<string, ScheduledJobEntry>();

  constructor(@Inject(DiscoveryService) private readonly discovery: DiscoveryService) {}

  onApplicationBootstrap(): void {
    const providers = this.discovery.getProviders();
    for (const wrapper of providers) {
      const instance = wrapper.instance as object | null;
      if (!instance || typeof instance !== "object") continue;
      const prototype = Object.getPrototypeOf(instance) as object | null;
      if (!prototype) continue;
      const decorations = getScheduledJobs(prototype);
      if (decorations.length === 0) continue;

      const className = (instance as { constructor?: { name?: string } }).constructor?.name ?? "?";
      for (const meta of decorations) {
        const fn = (instance as Record<string, unknown>)[meta.methodName];
        if (typeof fn !== "function") {
          this.log.warn(
            `ScheduledJob "${meta.name}" on ${className}.${meta.methodName} — method is not a function, skipping`,
          );
          continue;
        }
        if (this.entries.has(meta.name)) {
          this.log.warn(
            `ScheduledJob "${meta.name}" already registered — keeping the first binding (${this.entries.get(meta.name)?.source}), skipping ${className}.${meta.methodName}`,
          );
          continue;
        }
        const bound = fn.bind(instance) as () => Promise<unknown>;
        this.entries.set(meta.name, {
          name: meta.name,
          cron: meta.cron,
          source: `${className}.${meta.methodName}`,
          run: () => Promise.resolve(bound()),
        });
      }
    }
    this.log.log(
      `discovered ${this.entries.size} scheduled job${this.entries.size === 1 ? "" : "s"}: ${[...this.entries.keys()].sort().join(", ") || "<none>"}`,
    );
  }

  list(): readonly ScheduledJobEntry[] {
    return [...this.entries.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  async runOnce(name: string): Promise<unknown> {
    const entry = this.entries.get(name);
    if (!entry) throw new ScheduledJobNotFoundError(name);
    return entry.run();
  }
}
