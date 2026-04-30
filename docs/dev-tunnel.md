# Dev Tunnel — `bun run dev --tunnel`

`bun run dev --tunnel` exposes your local API to the public internet
through **Cloudflare Tunnel** (`cloudflared`). The original use case is
**webhook receiver testing** — Stripe, GitHub, Slack, OAuth callbacks,
Better-Auth social providers — all of which need a publicly reachable
HTTPS endpoint to call back into your dev server.

## When to use it

- ON  — You're wiring up a webhook integration and need an external
  service to call your local server. Your laptop is the only host that
  has the freshly written handler code.
- OFF — Default. You don't want random traffic to a `*.trycloudflare.com`
  URL hitting your dev environment.

`bun run dev` without `--tunnel` is the safe default. The tunnel never
starts unless you ask for it.

## Prerequisites

`cloudflared` must be on `PATH`:

| OS      | Install                                                               |
|---------|------------------------------------------------------------------------|
| macOS   | `brew install cloudflared`                                             |
| Linux   | <https://github.com/cloudflare/cloudflared/releases> (deb / rpm / tar) |
| Windows | `winget install --id Cloudflare.cloudflared`                           |

If `cloudflared` is missing, `bun run dev --tunnel` aborts with a
clear install hint — it never silently falls back.

## Quick-Tunnel (default)

```bash
bun run dev --tunnel
```

This calls `cloudflared tunnel --url http://localhost:<port>`. The
tunnel is **ephemeral and anonymous** — you don't need a Cloudflare
account. Cloudflare assigns a fresh `https://<random-words>.trycloudflare.com`
URL each time. After ~10 seconds the dev banner shows:

```
Tunnel
  Public URL          https://example-cute-name-123.trycloudflare.com
```

The URL is also visible at `GET /dev/tunnel.json`:

```bash
curl http://localhost:3001/dev/tunnel.json
# { "active": true, "url": "https://example-...", "startedAt": "2026-..." }
```

## Named-Tunnel (advanced, opt-in)

If you have a Cloudflare account with a configured named tunnel and
DNS routing, set `CLOUDFLARE_TUNNEL_NAME=<name>` and the runner will
use `cloudflared tunnel run <name>` instead of the quick form. The
URL stays stable across restarts.

```bash
CLOUDFLARE_TUNNEL_NAME=my-stable-tunnel bun run dev --tunnel
```

You're responsible for `cloudflared tunnel login`, creating the
tunnel, and routing your DNS — that's a one-time setup outside this
repo.

## Persisting the URL to `.env` (`--tunnel-write-env`)

```bash
bun run dev --tunnel-write-env
```

Adds the discovered URL to `.env` as `TUNNEL_PUBLIC_URL=https://...`.
The dev runner then triggers its `.env`-watch handler, which
respawns the API child so callers reading `process.env.TUNNEL_PUBLIC_URL`
pick it up. Use this when your code needs the public URL at runtime
(e.g. to set Better-Auth's social-OAuth callback dynamically).

> **Note:** The runner never overwrites `APP_BASE_URL` — that would
> break code paths that explicitly want the localhost form.

## Wiring webhooks

### Stripe CLI

```bash
stripe listen --forward-to https://example-cute-name-123.trycloudflare.com/webhooks/stripe
```

Trigger a test event with `stripe trigger payment_intent.succeeded`;
the Webhook-Inspector at `/admin/webhooks` shows the delivery.

### GitHub

GitHub repo → Settings → Webhooks → "Add webhook":
- Payload URL: `https://example-cute-name-123.trycloudflare.com/webhooks/github`
- Content type: `application/json`
- Secret: matches `WEBHOOK_GITHUB_SECRET` in your `.env`

### Slack

App config → Event Subscriptions → Request URL:
`https://example-cute-name-123.trycloudflare.com/webhooks/slack`

Slack does a one-time URL-verification handshake. The challenge handler
must be wired in your Slack receiver before adding the URL.

## Lifecycle

- The tunnel starts alongside the API.
- Ctrl-C (SIGINT/SIGTERM) tears down the tunnel — `pgrep cloudflared`
  reports nothing afterwards.
- A `.env` change respawns the API but leaves the tunnel running (the
  port is unchanged).
- If `cloudflared` does not report a URL within 30 seconds, the runner
  warns. Check the cloudflared logs — auth issues, edge unreachable,
  rate-limited account.

## Security

- **`*.trycloudflare.com` URLs are random but PUBLIC.** Anyone who
  guesses or scrapes the URL can hit your dev server.
- **Never run `--tunnel` with real-user data**. If your local DB has
  imported production data, kill the tunnel first.
- **Authentication still applies.** All Nest guards / auth middleware
  run unchanged — the tunnel just routes traffic to your `localhost`.
- **The tunnel is dev-only**. The `/dev/tunnel.json` endpoint and the
  banner block both 404 outside `NODE_ENV=development`, so a stale
  state file in production cannot leak the URL.

## Troubleshooting

| Symptom                                | Likely cause                                                                                  |
|----------------------------------------|-----------------------------------------------------------------------------------------------|
| `--tunnel requested but cloudflared is not on PATH` | install cloudflared (see [Prerequisites](#prerequisites))                                     |
| 30s warning, no URL                    | cloudflared edge unreachable — check `cloudflared --version`, retry, or use a different network |
| Tunnel up, webhook 404                 | wrong path on the URL — your handler is at `/webhooks/<provider>`, not `/`                    |
| URL changes after each restart         | quick-tunnels are ephemeral by design; use a named tunnel for stability                       |
| Stale URL after Ctrl-C in `/dev/tunnel.json` | the runner clears state on shutdown — if you see a stale URL, check that `bun run dev` exited cleanly |
