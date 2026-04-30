import { describe, expect, it, vi } from "vitest";

import { GeoIpService, type MmdbCityReader } from "../../src/core/geoip/geoip.service.js";

/**
 * Story · GeoIp Service
 *
 * `GeoIpService.lookup(ip)` flows:
 *   raw .mmdb record → mapMmdbCityRecord → normalised shape | null
 *
 * The reader is injected (`MmdbCityReader`) so unit tests can
 * pin a deterministic record without touching the maxmind npm
 * package or the filesystem. Cold-boot (no reader resolved) must
 * not crash — service returns `null` and logs a warning.
 */
describe("Story · GeoIp Service", () => {
  function makeReader(map: Record<string, unknown | null>): MmdbCityReader {
    return {
      get(ip: string) {
        return map[ip] ?? null;
      },
    };
  }

  it("returnt das gemappte Profil für eine bekannte IP", async () => {
    const service = new GeoIpService({
      readerFactory: () =>
        Promise.resolve(
          makeReader({
            "8.8.8.8": {
              country: { iso_code: "US", names: { en: "United States" } },
              city: { names: { en: "Mountain View" } },
              location: { latitude: 37.386, longitude: -122.0838, accuracy_radius: 1000 },
            },
          }),
        ),
    });
    const result = await service.lookup("8.8.8.8");
    expect(result).toMatchObject({
      countryCode: "US",
      city: "Mountain View",
      country: "United States",
    });
  });

  it("returnt null wenn die IP unbekannt ist", async () => {
    const service = new GeoIpService({
      readerFactory: () => Promise.resolve(makeReader({})),
    });
    expect(await service.lookup("203.0.113.1")).toBeNull();
  });

  it("returnt null wenn kein Reader vorhanden ist (cold-boot ohne .mmdb)", async () => {
    const warn = vi.fn();
    const service = new GeoIpService({
      readerFactory: () => Promise.resolve(null),
      logger: { warn, log: vi.fn(), error: vi.fn() },
    });
    expect(await service.lookup("8.8.8.8")).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("cached den Reader: readerFactory wird nur einmal aufgerufen", async () => {
    let calls = 0;
    const factory = () => {
      calls++;
      return Promise.resolve(makeReader({ "1.1.1.1": { country: { iso_code: "US" } } }));
    };
    const service = new GeoIpService({ readerFactory: factory });
    await service.lookup("1.1.1.1");
    await service.lookup("1.1.1.1");
    await service.lookup("1.1.1.1");
    expect(calls).toBe(1);
  });

  it("crasht nicht, wenn der Reader synchronously wirft", async () => {
    const error = vi.fn();
    const service = new GeoIpService({
      readerFactory: () =>
        Promise.resolve({
          get() {
            throw new Error("boom");
          },
        }),
      logger: { warn: vi.fn(), log: vi.fn(), error },
    });
    expect(await service.lookup("8.8.8.8")).toBeNull();
    expect(error).toHaveBeenCalledOnce();
  });

  it("returnt null bei leerer/undefined IP", async () => {
    const service = new GeoIpService({
      readerFactory: () => Promise.resolve(makeReader({})),
    });
    expect(await service.lookup("")).toBeNull();
    expect(await service.lookup(undefined as unknown as string)).toBeNull();
  });
});
