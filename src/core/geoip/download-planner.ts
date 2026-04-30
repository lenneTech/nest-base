/**
 * GeoIp Download Planner.
 *
 * Pure function: maps a provider + license-key + a `now` clock to the
 * download spec (URL, archive format, target path, refresh cadence,
 * attribution label). Has no I/O — `download-runner.ts` performs the
 * actual fetch + extract.
 *
 * The "pure planner / thin runner" split is enforced across the
 * codebase (see `src/core/CLAUDE.md`). It buys two things:
 *   - the planner is testable without network or filesystem
 *   - the runner can be swapped (real fetch vs. mocked), the URL/path
 *     contract stays single-sourced
 *
 * Provider matrix
 * ───────────────
 * `dbip-lite`  default. CC-BY-4.0, no account, monthly snapshot, URL
 *              embeds `YYYY-MM`. The Schrems-II-friendly choice — the
 *              client never identifies itself to a tracking endpoint.
 * `maxmind`    opt-in. License key required (free signup since Dec 2019),
 *              GeoLite2-City edition, weekly updates, tar.gz archive.
 *              Higher accuracy, but every download leaks the caller's
 *              IP to MaxMind's edge.
 */

export const GEOIP_PROVIDERS = ["dbip-lite", "maxmind"] as const;
export type GeoIpProvider = (typeof GEOIP_PROVIDERS)[number];

export const GEOIP_DEFAULT_DB_PATH = "./data/geoip/city.mmdb";

export type GeoIpArchiveFormat = "gz" | "tar.gz";
export type GeoIpUpdateCadence = "monthly" | "weekly";

export interface GeoIpDownloadPlan {
  provider: GeoIpProvider;
  url: string;
  /** Disk location the unpacked `.mmdb` should land at. */
  savePath: string;
  archiveFormat: GeoIpArchiveFormat;
  cadence: GeoIpUpdateCadence;
  /** Whether this provider mandates a license key on the URL. */
  requiresLicenseKey: boolean;
  /** Human-readable license / attribution label for log + UI surfaces. */
  licenseLabel: string;
}

export interface PlanGeoIpDownloadInput {
  provider: GeoIpProvider;
  /** Clock — passed in so the URL builder stays deterministic in tests. */
  now: Date;
  licenseKey?: string;
  dbPath?: string;
}

export class GeoIpUnsupportedProviderError extends Error {
  constructor(provider: string) {
    super(`unsupported GeoIP provider: ${provider}`);
    this.name = "GeoIpUnsupportedProviderError";
  }
}

export class GeoIpLicenseKeyMissingError extends Error {
  constructor(provider: GeoIpProvider) {
    super(
      `GeoIP provider "${provider}" requires a license key — set FEATURE_GEO_IP_LICENSE_KEY (free at maxmind.com)`,
    );
    this.name = "GeoIpLicenseKeyMissingError";
  }
}

/**
 * Build the deterministic download spec for the given provider + clock.
 *
 * `dbip-lite` derives a `YYYY-MM` snapshot from `now`. `maxmind` always
 * resolves the latest GeoLite2-City build via its query-string-shaped
 * download API.
 */
export function planGeoIpDownload(input: PlanGeoIpDownloadInput): GeoIpDownloadPlan {
  const savePath = input.dbPath ?? GEOIP_DEFAULT_DB_PATH;

  if (input.provider === "dbip-lite") {
    return {
      provider: "dbip-lite",
      url: buildDbipLiteUrl(input.now),
      savePath,
      archiveFormat: "gz",
      cadence: "monthly",
      requiresLicenseKey: false,
      licenseLabel: "CC-BY-4.0 (db-ip.com)",
    };
  }

  if (input.provider === "maxmind") {
    const trimmed = (input.licenseKey ?? "").trim();
    if (trimmed.length === 0) {
      throw new GeoIpLicenseKeyMissingError("maxmind");
    }
    return {
      provider: "maxmind",
      url: buildMaxmindUrl(trimmed),
      savePath,
      archiveFormat: "tar.gz",
      cadence: "weekly",
      requiresLicenseKey: true,
      licenseLabel: "MaxMind GeoLite2-City EULA (license_key required)",
    };
  }

  throw new GeoIpUnsupportedProviderError(input.provider);
}

function buildDbipLiteUrl(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `https://download.db-ip.com/free/dbip-city-lite-${year}-${month}.mmdb.gz`;
}

function buildMaxmindUrl(licenseKey: string): string {
  const params = new URLSearchParams({
    edition_id: "GeoLite2-City",
    license_key: licenseKey,
    suffix: "tar.gz",
  });
  return `https://download.maxmind.com/app/geoip_download?${params.toString()}`;
}
