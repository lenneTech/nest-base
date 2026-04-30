import { Injectable, Logger } from "@nestjs/common";

import { type GeoIpLookupResult, mapMmdbCityRecord } from "./resolver.js";

/**
 * GeoIpService — wraps a `.mmdb` reader and serves
 * `lookup(ip): GeoIpLookupResult | null`.
 *
 * Design pillars:
 *
 * 1. Reader is injected via `readerFactory()`. Production wiring
 *    lazy-imports the `maxmind` npm package only when the feature
 *    is enabled (see `geoip.module.ts`); tests pass an in-memory
 *    reader, no fixture file needed.
 *
 * 2. Cold-boot tolerance. If `readerFactory()` resolves to `null`
 *    (the `.mmdb` is missing on disk), `lookup()` logs once and
 *    returns `null` forever after. Crashing the boot for "GeoIP
 *    DB not synced yet" is hostile — the feature is a soft
 *    enhancement, not a critical-path dependency.
 *
 * 3. Reader is cached. The factory runs at most once per
 *    GeoIpService instance; subsequent lookups hit the cached
 *    reader, which itself ships with an internal LRU cache (~50µs
 *    per hit after warm-up).
 */

export interface MmdbCityReader {
  /** Returns the raw `.mmdb` record for an IP, or `null` if not found. */
  get(ip: string): unknown | null;
}

export interface GeoIpServiceLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string, err?: unknown): void;
}

export interface GeoIpServiceOptions {
  /** Factory that resolves the `.mmdb` reader once (lazy + cached). */
  readerFactory: () => Promise<MmdbCityReader | null>;
  logger?: GeoIpServiceLogger;
}

@Injectable()
export class GeoIpService {
  private readerPromise?: Promise<MmdbCityReader | null>;
  private warnedNoReader = false;
  private readonly logger: GeoIpServiceLogger;
  private readonly readerFactory: GeoIpServiceOptions["readerFactory"];

  constructor(options: GeoIpServiceOptions) {
    this.readerFactory = options.readerFactory;
    this.logger = options.logger ?? new Logger("GeoIpService");
  }

  async lookup(ip: string): Promise<GeoIpLookupResult | null> {
    if (!ip) return null;

    const reader = await this.getReader();
    if (!reader) {
      if (!this.warnedNoReader) {
        this.warnedNoReader = true;
        this.logger.warn(
          "GeoIP .mmdb not loaded — lookup returns null. Run `bun run scripts/download-geoip.ts` to populate the database.",
        );
      }
      return null;
    }

    let raw: unknown;
    try {
      raw = reader.get(ip);
    } catch (err) {
      this.logger.error(`GeoIP lookup failed for ${ip}`, err);
      return null;
    }

    return mapMmdbCityRecord(raw);
  }

  private getReader(): Promise<MmdbCityReader | null> {
    if (!this.readerPromise) {
      this.readerPromise = this.readerFactory().catch((err) => {
        this.logger.error("GeoIP reader factory threw", err);
        return null;
      });
    }
    return this.readerPromise;
  }
}
