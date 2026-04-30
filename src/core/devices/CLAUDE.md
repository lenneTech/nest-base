# `src/core/devices/` — agent guide

Device-handling subsystem (issue #13). Detects "new device" sign-ins,
emails the user, and revokes oldest sessions when the per-user cap
is exceeded. Five files, planner/runner split throughout.

```
devices/
├── fingerprint.ts            ← pure: sha256(mode, ua, masked-ip)
├── ua-parser.ts              ← pure: ua-parser-js wrapper, defensive defaults
├── device-handling.ts        ← pure: decision planner (known | new | first-sign-in)
├── new-device-throttle.ts    ← in-memory rate limit (1 mail / user / hour)
├── device-handling.runner.ts ← orchestrator (Better-Auth hook → plan → email)
├── device.controller.ts      ← GET /me/devices, DELETE /me/devices/:id
└── device.module.ts          ← NestJS module for the endpoints
```

## Activation

Off by default. Enable via:

```bash
FEATURE_DEVICE_MANAGEMENT_ENABLED=true
FEATURE_DEVICE_MANAGEMENT_MAX_DEVICES_PER_USER=10        # default 10
FEATURE_DEVICE_MANAGEMENT_NOTIFY_ON_NEW_DEVICE=true      # default true
FEATURE_DEVICE_MANAGEMENT_SESSION_FINGERPRINT=userAgent+ipSubnet
```

`BetterAuthModule` reads `features.deviceManagement` at provider
init: when off, the `databaseHooks.session.create.after` hook isn't
even registered — the auth path is byte-for-byte equivalent to
pre-#13 deployments.

## Fingerprint strategy

`fingerprintSession({ userAgent, ip, mode })` returns
`sha256(mode | ua | masked-ip)`:

- `userAgent+ipSubnet` (default) — IPv4 → /24, IPv6 → /64. The
  prefix-mask is the privacy / mobility compromise. A residential
  ISP rotates the IPv4 host octet on every modem reboot; a mobile
  carrier rotates it on every cellular hop. Hashing the full IP
  would mark every "bus-ride wifi → home wifi" hop as new. /24 +
  /64 line up with how carriers allocate subnets.
- `userAgent` only — the strict-privacy mode for jurisdictions that
  forbid IP-based tracking. The IP component is dropped from the
  hash entirely.

The *mode* is part of the hash input. Flipping the toggle on a live
deployment produces a fresh fingerprint set instead of silently
re-classifying every old session as "known".

## Privacy contract

- We store **only the hash** on `sessions.fingerprint`. The raw
  masked CIDR is an internal intermediate. `maskIp()` is exposed
  for diagnostics only — callers must not persist its return.
- Raw IPs / UAs stay in their existing `sessions.ip_address` /
  `sessions.user_agent` columns and are deleted when the session
  expires (per Better-Auth's normal lifecycle).
- The new-device email surfaces **city + country only**. Even when
  GeoIP returns lat/lng, the runner drops them before rendering.
  When GeoIP returns nothing usable, the email shows "Location
  unknown" + the raw IP (so the user has *something* to cross-check
  against their own router / VPN).

## Throttle policy

`createNewDeviceThrottle()` caps new-device emails at **1 per user
per hour** (default). The throttle is in-memory; for multi-instance
deploys, swap the storage with a Redis-backed implementation
behind the same `NewDeviceThrottle` interface.

The throttle is record-on-success: a denied throttle slot, a
planner exception, or a queue write failure does **not** burn the
slot. Users on flaky connections can retry within the window
without losing their notification budget.

## Device cap + revoke

`decideDeviceHandling({ ..., maxDevicesPerUser })` decides:

- `first-sign-in` — no prior sessions; record the fingerprint, no
  email (a brand-new account shouldn't get a "new device" mail
  about its very first session).
- `known` — a prior session shares the fingerprint; refresh
  `lastSeenAt` (Prisma's `@updatedAt` does this automatically) and
  do nothing else.
- `new-device` — fingerprint is new; enqueue the email. When
  `(prior sessions count + 1) > cap`, also include
  `revokeSessionId` pointing at the oldest existing session
  (NOT the just-created one). The runner deletes the row before
  emailing so the email's "review devices" link reflects the
  post-revoke state.

`selectOldestSessionForRevoke()` picks by `lastSeenAt` then
`createdAt` — the same tie-breaker the controller would use if a
user manually revokes from the dev-portal.

## Failure semantics

The runner **never throws back into the auth flow**. The sign-in
already succeeded by the time `databaseHooks.session.create.after`
runs; any DB error / GeoIP outage / mail queue failure is logged
to the `DeviceHandling` channel and swallowed.

## Endpoints

`/me/devices` is mounted under `DeviceModule` (always wired,
independent of the feature flag — the feature gates the *fingerprint
pipeline*, not the read surface):

| Method | Path                | Auth | Effect                                      |
| ------ | ------------------- | ---- | ------------------------------------------- |
| GET    | `/me/devices`       | yes  | Lists the user's active sessions, parsed UA |
| DELETE | `/me/devices/:id`   | yes  | Revokes a session; ownership check enforced |

Both endpoints are tenant-scoped (the global `TenantInterceptor`
applies). Frontend / SDK callers must send `x-tenant-id`.

## Tests

| Layer                      | File                                                    |
| -------------------------- | ------------------------------------------------------- |
| Fingerprint planner        | `tests/stories/device-fingerprint.story.test.ts`        |
| UA parser                  | `tests/stories/device-ua-parser.story.test.ts`          |
| Decision planner           | `tests/stories/device-handling.story.test.ts`           |
| Email payload              | `tests/stories/new-device-email-payload.story.test.ts`  |
| Hook runner + throttle     | `tests/stories/new-device-email-runner.story.test.ts`   |
| Orchestrator (mocked deps) | `tests/stories/device-handling-runner.story.test.ts`    |
| Full e2e (boots app)       | `tests/devices.e2e-spec.ts`                             |

## Hard rules

- `.js` extension on every relative import (ESM contract).
- Planners are pure: no I/O, no `Date` construction, no env reads.
- Every error in the runner pipeline is caught and logged — never
  thrown back into the Better-Auth hook.
- Lat/lng never reach the email body — `formatLocation()` drops
  them even when GeoIP supplies them.
- The fingerprint hash is the only device-identity we persist; the
  raw masked-CIDR string is a transient intermediate.
