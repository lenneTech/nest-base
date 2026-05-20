# Hub Dashboard

**Route:** `/hub` (React SPA — `HubLandingPage`)
**Backend:** `src/core/dx/hub.controller.ts` (`dashboardJson`)
**Frontend:** `src/core/dx/clients/pages/HubLandingPage.tsx`

---

## Overview

The Hub dashboard is the **operator cockpit** after login. It surfaces
live runtime health — not CI artefacts. Coverage and test summaries live
on their own pages (`/hub/coverage`, `/hub/tests`).

Primary data source:

```
GET /hub/dashboard.json
```

Polled every 5 seconds. Service probes refresh separately via
`GET /hub/status.json` (4 s interval) so probe dots update without
reloading the full dashboard payload.

---

## Layout (top to bottom)

### Hero — overall health

Border colour reflects operational state derived from probes, status
groups, slow queries, and error-level logs — **not** coverage or test
counts.

| State | Colour | Typical trigger |
|-------|--------|-----------------|
| `OK` | green | Probes up, status groups green, no critical log noise |
| `WARN` | yellow | Pending jobs, slow queries, or warn-level log pressure |
| `ERR` | red | Probe down, failed migrations, dead-letter jobs, error logs |

### Services strip

Grid of HTTP probes (Postgres, Mailpit, Scalar, …). Re-polled via
`/hub/status.json`. Green / red / grey dots with latency labels.

### Operator status groups

Four cards (order: database → async → runtime → external):

| Group ID | Label | Detail page |
|----------|-------|-------------|
| `database` | Database | `/hub/migrations` |
| `async` | Async / Queue | `/hub/jobs` |
| `runtime` | Runtime | `/hub/diagnostics` |
| `external` | External Services | `/hub/diagnostics` |

Each item shows label, value, and per-item status dot. Group badge is
the worst item in the group (`buildDashboardStatusGroups` in
`dashboard-health-planner.ts`).

### Ops metrics row

Four tiles for day-to-day operations:

| Tile | Source |
|------|--------|
| **Pending jobs** | `asyncMetrics.pendingJobCount` |
| **Dead letters** | `asyncMetrics.deadLetterCount` |
| **Slow queries** | `queries.slow` from query buffer |
| **Error logs** | recent ring-buffer entries at error/fatal level |

### Cloudflare Tunnel

Shown when `tunnel.active === true` (from `tunnel.json` lock file written
by `bun run dev --tunnel`).

### Activity charts (optional)

Rendered only when data is available — no empty chart placeholders.

| Chart | Field | Notes |
|-------|-------|-------|
| Requests / min | `requestsChart` | Stacked 2xx / 4xx / 5xx; hidden when `available: false` |
| Sessions | `sessionsChart` | Active + new logins from Prisma session table |
| Geo top countries | `geoTopCountries` | Requires GeoIP feature + database installed |

### Logs preview + features + quick links

- **Logs** — last records from the in-memory ring buffer; link to `/hub/logs`
- **Features** — catalog snapshot with active/total ratio; link to `/hub/features`
- **Quick navigation** — filtered by `hub-nav-planner.ts` + enabled feature flags

---

## Backend aggregation

`HubController.dashboardJson()` builds the payload from runtime sources:

| Field | Provider |
|-------|----------|
| `statusGroups` | `buildDashboardStatusGroups()` + `loadDashboardAsyncMetrics()` |
| `probes` | `probeServices(planServiceCandidates(...))` |
| `sessionsChart` | `loadDashboardSessionsChart(prisma)` |
| `requestsChart` | placeholder `{ available: false }` until request logging ships |
| `geoTopCountries` | placeholder `{ available: false }` until geo aggregation ships |
| `logs` | `getLogBuffer().recent(50)` |
| `queries` | `getQueryBuffer().summary()` |
| `tunnel` | `readTunnelState()` |
| `features` / `catalog` | feature schema + static catalog |

Coverage and test JSON are **not** included in `dashboard.json`; use
`/hub/coverage.json` and `/hub/tests.json` on their dedicated pages.

---

## Auth + tenancy

- **Login:** Better-Auth session (see [`login.md`](./login.md)).
- **Tenant scope:** `POST /api/auth/organization/set-active` →
  `session.activeOrganizationId`. The `x-tenant-id` header is ignored.
- **Dev gate:** `assertDev()` — routes return **404** outside
  `NODE_ENV=development`.
