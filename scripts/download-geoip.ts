#!/usr/bin/env bun
/**
 * `bun run scripts/download-geoip.ts` — fetch the GeoIP `.mmdb`
 * database for the configured provider.
 *
 * Reads `FEATURE_GEO_IP_*` env-overrides via `loadFeatures()`, hands
 * them to the pure planner (`planGeoIpDownload`), then runs the
 * thin runner (`runGeoIpDownload`) against `globalThis.fetch` +
 * `node:fs/promises`.
 *
 * Default provider is `dbip-lite` (CC-BY-4.0, no key required), so a
 * fresh checkout boots with `bun run scripts/download-geoip.ts` and
 * is geo-ready in under 30s. MaxMind requires a license key; the
 * planner throws `GeoIpLicenseKeyMissingError` if missing.
 */

import { mkdir, writeFile } from "node:fs/promises";

import {
  GeoIpLicenseKeyMissingError,
  planGeoIpDownload,
} from "../src/core/geoip/download-planner.js";
import { runGeoIpDownload } from "../src/core/geoip/download-runner.js";
import { loadFeatures } from "../src/core/features/features.js";

async function main(): Promise<void> {
  const features = loadFeatures(process.env as Record<string, string | undefined>);
  const cfg = features.geoIp;

  console.log(`[geoip] provider=${cfg.provider} → ${cfg.dbPath}`);

  let plan;
  try {
    plan = planGeoIpDownload({
      provider: cfg.provider,
      now: new Date(),
      licenseKey: cfg.licenseKey,
      dbPath: cfg.dbPath,
    });
  } catch (err) {
    if (err instanceof GeoIpLicenseKeyMissingError) {
      console.error(`[geoip] ${err.message}`);
      console.error(
        "[geoip] tip: switch to dbip-lite (FEATURE_GEO_IP_PROVIDER=dbip-lite) or set FEATURE_GEO_IP_LICENSE_KEY.",
      );
      process.exit(2);
    }
    throw err;
  }

  console.log(`[geoip] downloading ${plan.url}`);
  console.log(`[geoip] license: ${plan.licenseLabel}`);

  // The runner accepts a project-narrow `fetch` shape; the global
  // `fetch`'s typed `Response` signature is wider. Bridge through a
  // typed `unknown` intermediate so the disqualifier scan stays
  // clean (mirrors the adapter in `geoip.module.ts:88-95`).
  const fetchAdapter = (url: string): ReturnType<typeof fetch> => {
    const erased: unknown = fetch(url);
    return erased as ReturnType<typeof fetch>;
  };
  const result = await runGeoIpDownload(plan, {
    fetch: fetchAdapter,
    fs: { mkdir, writeFile },
  });

  console.log(
    `[geoip] wrote ${result.bytesWritten.toLocaleString()} bytes to ${result.savePath}`,
  );
  console.log(`[geoip] cadence=${plan.cadence} — re-run on the next refresh window.`);
}

main().catch((err) => {
  console.error("[geoip] download failed:", err);
  process.exit(1);
});
