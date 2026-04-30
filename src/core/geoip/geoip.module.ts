import { existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import { Injectable, Logger, Module, type OnModuleInit } from "@nestjs/common";

import { GeoIpLicenseKeyMissingError, planGeoIpDownload } from "./download-planner.js";
import { runGeoIpDownload } from "./download-runner.js";
import { loadFeatures } from "../features/features.js";
import { GeoIpService, type MmdbCityReader } from "./geoip.service.js";
import { planGeoIpRefreshSchedule } from "./refresh-schedule.js";

/**
 * GeoIpModule — provides `GeoIpService` with a lazy `.mmdb` reader.
 *
 * The `maxmind` npm package is loaded **only when the feature is on
 * AND the `.mmdb` exists at the configured path**. This keeps:
 *   - cold builds tiny (the package is in `optionalDependencies`)
 *   - test runs fast (CI doesn't install or load it unless asked)
 *   - production failure-mode soft (missing `.mmdb` → null result,
 *     never a boot crash)
 *
 * Even when the feature is off the module is still importable —
 * downstream code can inject `GeoIpService` and rely on the
 * cold-boot null contract instead of branching on a feature flag
 * at every call-site.
 */
/**
 * GeoIpRefreshCron — re-downloads the `.mmdb` on the cadence dictated
 * by `planGeoIpRefreshSchedule()`. Wakes up once every 24h, asks the
 * planner whether a refresh is due, and either skips or runs the
 * download. `lastRunMs` tracks the last successful refresh in
 * memory; in production the worker can persist it via pg-boss state
 * once the queue is wired (see `src/core/jobs/`).
 *
 * Failures are swallowed with a warning — geo lookup is best-effort,
 * a stale `.mmdb` is preferable to a crashed boot.
 */
@Injectable()
class GeoIpRefreshCron implements OnModuleInit {
  private readonly logger = new Logger("GeoIpRefreshCron");
  private timer?: ReturnType<typeof setInterval>;
  private lastRunMs: number | null = null;

  onModuleInit(): void {
    const features = loadFeatures(process.env as Record<string, string | undefined>);
    const cfg = features.geoIp;
    const schedule = planGeoIpRefreshSchedule({
      provider: cfg.provider,
      enabled: cfg.enabled,
    });
    if (!schedule.shouldRun) return;

    // Seed the "last run" with the file's mtime if it exists, so a
    // restart doesn't re-download a fresh database.
    try {
      const absolute = resolvePath(cfg.dbPath);
      if (existsSync(absolute)) {
        this.lastRunMs = statSync(absolute).mtimeMs;
      }
    } catch {
      this.lastRunMs = null;
    }

    this.logger.log(
      `GeoIP refresh scheduled: cadence=${schedule.cadence}, tick=${schedule.tickMs}ms`,
    );
    this.timer = setInterval(() => {
      void this.maybeRun(cfg.provider, cfg.licenseKey, cfg.dbPath, schedule).catch((err) =>
        this.logger.warn(`GeoIP refresh tick failed: ${err}`),
      );
    }, schedule.tickMs);
    // Don't keep the event loop alive in tests / CLI tools.
    this.timer.unref?.();
  }

  private async maybeRun(
    provider: "dbip-lite" | "maxmind",
    licenseKey: string | undefined,
    dbPath: string,
    schedule: ReturnType<typeof planGeoIpRefreshSchedule>,
  ): Promise<void> {
    const now = Date.now();
    if (!schedule.isRefreshDue(now, this.lastRunMs)) return;

    try {
      const plan = planGeoIpDownload({ provider, now: new Date(now), licenseKey, dbPath });
      const result = await runGeoIpDownload(plan, {
        fetch: (url) => fetch(url) as unknown as ReturnType<typeof fetch>,
        fs: { mkdir, writeFile },
      });
      this.lastRunMs = now;
      this.logger.log(
        `GeoIP refresh complete: ${result.bytesWritten.toLocaleString()} bytes → ${result.savePath}`,
      );
    } catch (err) {
      if (err instanceof GeoIpLicenseKeyMissingError) {
        this.logger.warn(err.message);
        return;
      }
      this.logger.warn(
        `GeoIP refresh failed (will retry on next tick): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

@Module({
  providers: [
    {
      provide: GeoIpService,
      useFactory: (): GeoIpService => {
        const features = loadFeatures(process.env as Record<string, string | undefined>);
        const cfg = features.geoIp;
        const logger = new Logger("GeoIpService");
        return new GeoIpService({
          readerFactory: () => createMaxmindReader(cfg.dbPath, cfg.enabled, logger),
        });
      },
    },
    GeoIpRefreshCron,
  ],
  exports: [GeoIpService],
})
export class GeoIpModule {}

/**
 * Structural type for the `maxmind` npm package's public surface
 * we depend on. Defined locally so the module compiles even when
 * the optional dependency isn't installed (e.g. CI / projects
 * that never enable the feature).
 */
interface MaxmindReaderShape {
  get(ip: string): unknown;
}
interface MaxmindModuleShape {
  open?: (path: string) => Promise<MaxmindReaderShape>;
  default?: {
    open?: (path: string) => Promise<MaxmindReaderShape>;
  };
}

/**
 * Lazy-load the `maxmind` package + open the `.mmdb` file. Both
 * `dbip-lite` and MaxMind's GeoLite2-City emit the same binary
 * format, so a single reader serves both providers.
 *
 * Returns `null` when:
 *   - the feature is disabled (caller skips lookup gracefully)
 *   - the `.mmdb` file is missing on disk
 *   - the maxmind package isn't installed (ZeroDeps install path)
 *   - any of the above throws while loading
 */
async function createMaxmindReader(
  dbPath: string,
  enabled: boolean,
  logger: Logger,
): Promise<MmdbCityReader | null> {
  if (!enabled) return null;
  const absolute = resolvePath(dbPath);
  if (!existsSync(absolute)) {
    logger.warn(`GeoIP .mmdb not found at ${absolute} — lookups disabled.`);
    return null;
  }
  try {
    // Lazy import — never bundled or evaluated unless the feature is
    // on. The package is declared in `optionalDependencies` so a
    // consumer that doesn't enable GeoIP doesn't pull it in. The
    // identifier is hidden behind a string so `tsc` doesn't try to
    // resolve the type when the package isn't installed.
    const moduleId = "maxmind";
    const dynamicImport = new Function("id", "return import(id)") as (
      id: string,
    ) => Promise<unknown>;
    const maxmind = (await dynamicImport(moduleId)) as MaxmindModuleShape;
    const opener = maxmind.open ?? maxmind.default?.open;
    if (typeof opener !== "function") {
      logger.warn("`maxmind` package found but exports no `open()` — lookups disabled.");
      return null;
    }
    const reader = await opener(absolute);
    logger.log(`GeoIP reader opened: ${absolute}`);
    return {
      get(ip: string) {
        // maxmind's reader.get returns the raw City record or null.
        return reader.get(ip);
      },
    };
  } catch (err) {
    logger.warn(
      `GeoIP setup failed (\`maxmind\` package not installed or .mmdb invalid): ${
        err instanceof Error ? err.message : String(err)
      }. Run \`bun add maxmind\` and \`bun run scripts/download-geoip.ts\`.`,
    );
    return null;
  }
}
