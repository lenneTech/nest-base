# Hub Dashboard

**Route:** `/hub` (root — served by `@Get()` on `DevHubController`)
**Issue:** #88
**Backend path:** `src/core/dx/dev-hub.controller.ts`
**Frontend path:** `src/core/dx/clients/pages/DevHubLandingPage.tsx`

---

## Overview

The Hub dashboard is the operator landing page after login. It provides a
real-time cockpit for every sub-system of the server: service health,
request traffic, active sessions, coverage, test results, feature flags,
and live log preview — all on a single page.

Data comes from a single aggregated endpoint:

```
GET /api/hub/dashboard.json
```

This endpoint is re-polled every 5 seconds (`refetchInterval: 5_000`).
Service probes within the **Services** strip are additionally re-polled
every 4 seconds via `GET /api/hub/status.json` so the coloured status
dots update without a full dashboard reload.

---

## Layout (top to bottom)

### Hero — overall health + runtime metrics

A full-width card whose border colour reflects the worst-case state:

| State | Colour | Trigger |
|-------|--------|---------|
| `OK` | green | All probes up, all tests pass, coverage gates pass |
| `WARN` | yellow | Coverage below threshold |
| `ERR` | red | At least one probe down, or test suite failing |

Four metric tiles appear to the right of the state label:

| Tile | Source |
|------|--------|
| **Uptime** | `dashboard.uptimeMs` |
| **Heap** | `dashboard.memory.heapUsed / heapTotal` |
| **Node / Bun** | `dashboard.process.bun` or `dashboard.process.node` |
| **Base URL** | `dashboard.baseUrl` |

### Operator status groups

Four coloured cards, each linking to a detail page:

| Group ID | Label | Links to |
|----------|-------|----------|
| `database` | Database | `/hub/migrations` |
| `async` | Async / Queue | `/hub/jobs` |
| `external` | External Services | `/hub/diagnostics` |
| `runtime` | Runtime | `/hub/diagnostics` |

Each card shows a dot-per-item breakdown (label + value + green/yellow/red dot).
The group's overall status badge (`OK` / `Warnung` / `Fehler` / `Unbekannt`)
is derived from the worst item within the group.

### Charts row

Two side-by-side charts using Recharts:

**Requests / min — last 24 hours** (spans 2 of 3 columns):
- Stacked area chart with three series: `2xx` (green), `4xx` (yellow),
  `5xx` (red)
- Buckets are 5-minute intervals; X-axis shows hourly ticks
- Source: `dashboard.requestsChart.buckets[]`

**Sessions** (1 of 3 columns):
- Line chart with two series: `Aktiv` (lime) and `Neue Logins` (green)
- Source: `dashboard.sessionsChart.buckets[]`

Both charts show an empty state when no data has been collected yet.

### Geographic request distribution

A table of the top countries by request volume:

| Column | Source |
|--------|--------|
| Country code + name | `geoTopCountries.countries[].country` |
| Request count | `.requests` |
| Share (%) | computed: requests / total |

Requires the GeoIP database to be installed and the request log active.
Shows an empty state otherwise.

### Stats grid

Five stat tiles that link to deeper pages:

| Tile | Value | Badge |
|------|-------|-------|
| **Coverage** | `cov.total.lines.pct %` | `✓ Gates OK` / `unter Schwellwert` / `kein Run` |
| **Tests** | `passed / total` | `✓ alle grün` / `N fehlgeschlagen` / `kein Run` |
| **Features** | `active / total` | count of available (disabled) features |
| **Aktuelle Logs** | ring-buffer count | error/warn badge or `sauber` |
| **DB-Abfragen** | total query count | `alle schnell` / slow count / critical count |

### Cloudflare Tunnel card

Shown only when `dashboard.tunnel.active === true`. Displays the public
tunnel URL with a copy button and an external link. A warning note
reminds operators not to expose real user data via the tunnel.

### Services strip

A grid of service probe cards, re-polled every 4 s:

- **Green dot + glow** — probe returned 2xx within the last poll
- **Red dot + glow** — probe returned non-2xx or timed out
- **Grey dot** — status unknown (first poll not yet complete)

Each card shows: name, probe URL (monospace), status label, and latency.

### Live-Logs preview

Last 10 log records from the in-memory ring buffer, newest first.
Columns: time (HH:MM:SS), level badge (`fatal` / `error` / `warn` /
`info`), context tag, message. A link to `/hub/logs` navigates to the
full log page.

### Feature overview

A 2-column list of all feature flags from the catalog.
Active flags have a lime background; inactive flags have a muted
background. A progress bar shows active / total ratio. A link leads to
`/hub/features` for toggling.

### Quick navigation

A grid of 11 direct links to the most-used Hub and admin tools:

- Scalar API Reference → `/api/docs`
- OpenAPI-Spec → `/openapi`
- Permission Tester → `/admin/permissions/test`
- Webhook Inspector → `/admin/webhooks`
- Realtime Inspector → `/admin/realtime`
- Audit Browser → `/admin/audit`
- Search Tester → `/admin/search`
- Mandantenverwaltung → `/admin/tenants`
- Fehlerkatalog → `/errors`
- PostgREST Parser → `/hub/postgrest-parse`
- Diagnose → `/hub/diagnostics`

---

## Backend aggregation

`GET /api/hub/dashboard.json` is served by
`DevHubController.dashboardJson()`. It assembles the `DashboardJson`
object from several sub-services:

| Field | Provider |
|-------|----------|
| `statusGroups` | `StatusGroupService` — probes database, queue, and external deps |
| `requestsChart` | `RequestLogService` — 5-minute buckets over the last 24 hours |
| `sessionsChart` | `SessionLogService` — hourly login + active counts |
| `geoTopCountries` | `GeoLogService` — requires MaxMind GeoIP |
| `probes` | `ServiceProbeService` — per-service HTTP checks |
| `coverage` | reads `reports/coverage/coverage-summary.json` if present |
| `tests` | reads `reports/tests/test-results.json` if present |
| `logs` | `LogRingBuffer` — in-memory ring, capacity configurable via ENV |
| `queries` | `QueryInstrumentService` — Prisma query metrics |
| `tunnel` | `TunnelService` — Cloudflare Tunnel state |
| `features` | `FeaturesService` — current feature flag values |
| `catalog` | `FeatureCatalogService` — static metadata |

The endpoint is path-allowlisted under `/hub/` and requires the operator
to be logged in (Hub login at `/`).

---

## Security

The Hub serves on the `/hub/*` path prefix which is a dev-only
allowlist (`DevHubController` returns 404 outside `NODE_ENV=development`).
All Hub pages require the operator to authenticate via the login page at
`/`; the session is validated by the NestJS JWT middleware on the Hub
controller before any data is returned.
