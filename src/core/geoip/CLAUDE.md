# `src/core/geoip/` — IP→Geo Lookup

Offline IP-to-country/city resolution backed by an `.mmdb` file. Two
providers ship out of the box; the wire-format is identical so a
single reader serves both.

## Provider matrix

| Provider    | License                    | Account    | Cadence | Default | Use when                                     |
| ----------- | -------------------------- | ---------- | ------- | ------- | -------------------------------------------- |
| `dbip-lite` | CC-BY-4.0 (db-ip.com)      | none       | monthly | yes     | DSGVO-strict / Schrems-II / no signup needed |
| `maxmind`   | MaxMind GeoLite2-City EULA | yes (free) | weekly  | opt-in  | higher accuracy, faster updates accepted     |

Switch providers via `FEATURE_GEO_IP_PROVIDER` (`.env` or runtime
override). MaxMind also requires `FEATURE_GEO_IP_LICENSE_KEY`. See
`.env.example` for the full set.

## Files

| File                  | Role                                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `download-planner.ts` | Pure planner — `provider` + `now` → `{ url, savePath, archiveFormat, cadence, licenseLabel }`. Throws on missing license key for MaxMind.                                          |
| `download-runner.ts`  | Thin runner — fetches the URL, decompresses (`gz` for dbip-lite, `tar.gz` for MaxMind), extracts the `.mmdb` payload, writes it to `savePath`. Both `fetch` and `fs` are injected. |
| `resolver.ts`         | Pure mapper — raw `.mmdb` city record → normalised `GeoIpLookupResult`. Falls back gracefully on partial records (dbip-lite often omits city data).                                |
| `geoip.service.ts`    | `GeoIpService.lookup(ip)` — wraps the reader + caches the lookup result. Cold-boot tolerant: missing `.mmdb` → null + warning, never a crash.                                      |
| `geoip.module.ts`     | NestJS module that lazy-imports the `maxmind` npm package only when the feature is on AND the file exists at the configured path.                                                  |

## Operational lifecycle

1. **Initial population** — run `bun run scripts/download-geoip.ts`
   on the host, or `docker compose --profile geoip up geoip-init` in
   container setups. `data/geoip/city.mmdb` lands on disk.
2. **Feature toggle** — `FEATURE_GEO_IP_ENABLED=true` in `.env`. The
   server picks up the file on next boot.
3. **Refresh cadence** — dbip-lite ships a fresh build the first day
   of each month; MaxMind pushes weekly. The recommended cron is a
   pg-boss job that calls the runner at the matching cadence (see
   the example wiring in `geoip.module.ts` once the
   `JobQueueService` carries scheduled jobs).

## Schrems-II note

MaxMind's download endpoint records the requesting IP. For
DSGVO-strict deployments where the build host's IP must not leak to
US infrastructure, stay on `dbip-lite`. The query data flow itself
never leaves the server — both providers are queried offline against
the local `.mmdb` after the initial download.

## Test seam

`mapMmdbCityRecord(raw)` is a pure function; `GeoIpService` accepts
an injected `MmdbCityReader`. Together they make the whole pipeline
testable without a real `.mmdb` fixture. End-to-end coverage with a
real reader needs a tiny sample database — fetch the maxmind
package's `test-data/GeoLite2-City-Test.mmdb` if you ever need it,
but the pure tests cover the contract.
