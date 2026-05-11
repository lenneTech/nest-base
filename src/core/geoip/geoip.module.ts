import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import { Logger, Module } from "@nestjs/common";

import { loadFeatures } from "../features/features.js";
import { GeoIpRefreshCron } from "./geoip-refresh-cron.js";
import { GeoIpService, type MmdbCityReader } from "./geoip.service.js";

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
    {
      provide: GeoIpRefreshCron,
      useFactory: (): GeoIpRefreshCron => {
        const features = loadFeatures(process.env as Record<string, string | undefined>);
        const cfg = features.geoIp;
        return new GeoIpRefreshCron({
          enabled: cfg.enabled,
          provider: cfg.provider,
          dbPath: cfg.dbPath,
          licenseKey: cfg.licenseKey,
        });
      },
    },
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
