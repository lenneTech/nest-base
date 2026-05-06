# Webhook Spec

Outgoing webhooks emitted by a project running this template follow the
[Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks)
convention. This document is the contract a webhook *consumer* (your
customer's side, or a downstream service) implements to verify incoming
deliveries.

## Headers

Every delivery carries:

| Header | Purpose |
|--------|---------|
| `Webhook-Id` | UUID identifying this delivery attempt. Used as the idempotency key on the receiver side. |
| `Webhook-Timestamp` | Unix-seconds integer when the dispatcher signed the payload. |
| `Webhook-Signature` | HMAC-SHA256 signature(s) — `t=<unix>,v1=<base64>` format, comma-separated. May contain multiple `v1=` entries during key rotation. |
| `Content-Type` | `application/json`. |

## Signature

The signature is **HMAC-SHA256** over the string

```
{Webhook-Id}.{Webhook-Timestamp}.{request-body}
```

with the per-endpoint secret as the HMAC key. The Standard-Webhooks
`t=,v1=` header format encodes the timestamp + signature on the same line:

```
Webhook-Signature: t=1716998400,v1=AbC123…(base64)
```

During key rotation the dispatcher emits **both** signatures simultaneously:

```
Webhook-Signature: t=1716998400,v1=NEW…,v1=OLD…
```

Receivers MUST accept the request when *any* of the `v1=` entries verifies
against a known secret. This is how Standard Webhooks specifies seamless
rotation.

## Replay protection

The `Webhook-Timestamp` is in the signed string, so a replayed body sent
later cannot reuse an old signature without changing the timestamp. The
template tolerates **300 seconds of clock skew** by default — receivers
should reject anything older than ~5 minutes to defeat replay attacks.

The `Webhook-Id` is unique per delivery attempt; receivers should treat
it as the idempotency key for their handler so a double-fire (e.g. retry
after a network blip) does not double-process the event.

## Retry policy

When the dispatcher receives a non-2xx response (or a timeout), it retries
with **exponential backoff**:

| Attempt | Delay before |
|---------|--------------|
| 1 | — (initial send) |
| 2 | 1 second |
| 3 | 2 seconds |
| 4 | 4 seconds |
| … | doubles each time, capped at 1 hour |

The dispatcher gives up after 20 consecutive failed attempts and **auto-
disables the endpoint**. The endpoint owner sees the disable in
`/admin/webhooks` and must re-enable it manually after fixing the
upstream side.

Successful deliveries reset the failure counter — a flaky endpoint that
recovers does not stay disabled.

## Inspecting deliveries

The Webhook-Inspector at `/admin/webhooks` is a three-column React
SPA (issue #19):

- **Endpoint sidebar** — per-endpoint counters (total / delivered /
  failed / p95 latency) plus a 24-hour sparkline. Click an endpoint to
  filter the delivery list.
- **Delivery list** — virtual-scrolled (`@tanstack/react-virtual`)
  list of deliveries newest-first with status / HTTP / attempt /
  latency columns. Filter bar combines endpoint, status, event-type,
  and ID-search.
- **Detail drawer** — Request / Response / Curl tabs with
  `X-Webhook-*` header highlighting, a CSRF-protected re-deliver
  action, a copy-curl button, and a deep link to `/hub/traces` when a
  `traceId` is recorded.

JSON sidecars (all gated to `NODE_ENV=development`):

| Endpoint | Purpose |
|---|---|
| `GET /admin/webhooks.json` | Filtered + cursor-paged delivery list, ships a per-request CSRF token |
| `GET /admin/webhooks/aggregates.json` | Per-endpoint aggregates + sparkline |
| `GET /admin/webhooks/:id.json` | Delivery detail with reconstructed request headers / body and a copy-curl command |
| `POST /admin/webhooks/:id/redeliver` | Manual re-deliver, requires the CSRF token from the list response |

The CSRF token is an HMAC-signed nonce + issuance timestamp; the
secret is `WEBHOOK_INSPECTOR_CSRF_SECRET` (auto-generated when unset
in dev). 30-minute TTL.

It's the page to send to a customer who reports "the webhook never
arrived"; the answer is usually visible in two clicks.

## Receiver-side verification (reference)

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(req: Request, secret: string): boolean {
  const id = req.headers.get('Webhook-Id');
  const ts = req.headers.get('Webhook-Timestamp');
  const sig = req.headers.get('Webhook-Signature');
  if (!id || !ts || !sig) return false;

  // Skew tolerance — reject anything older than 5 minutes.
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > 300) return false;

  const signedString = `${id}.${ts}.${await req.text()}`;
  const expected = createHmac('sha256', secret).update(signedString).digest('base64');

  // Multiple `v1=` entries during key rotation — match any.
  return sig
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1='))
    .some((part) => timingSafeEqual(Buffer.from(part.slice(3), 'base64'), Buffer.from(expected, 'base64')));
}
```

This snippet is intentionally minimal — production code should also
verify the `Content-Type` and bound the body size before HMAC-ing it.
