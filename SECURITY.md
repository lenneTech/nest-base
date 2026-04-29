# Security Policy

We take security seriously — `nest-base` ships into many projects via
`bun run sync:from-template`, so a vulnerability in `src/core/` is
multiplied across every consumer.

## Reporting a vulnerability

**Please do not file a public issue or PR for security problems.**

Use GitHub's [private vulnerability reporting](https://github.com/lenneTech/nest-base/security/advisories/new)
form. We monitor it, and the disclosure stays private until a fix is
ready.

If you can't use GitHub for any reason, email **security@lenne.tech**.

When you report, please include:

- A clear description of the vulnerability and its impact
- A minimal reproducible example or proof of concept
- The affected version (`bun.lock` revision or commit SHA)
- Any mitigations you've already identified

We aim to acknowledge reports within **48 hours** on weekdays and
publish a fix + advisory within **30 days** for high/critical
findings.

## What's in scope

- Authentication / session handling (Better-Auth wiring, API keys, JWT)
- Authorization (CASL ability resolution, output-pipeline filters)
- Multi-tenancy (RLS bypass, tenant-isolation breaks)
- Injection vectors (SQL, NoSQL, command, path traversal, XSS in dev hub)
- Secret leakage (in error responses, logs, OpenAPI spec)
- CSRF / SSRF on non-GET endpoints
- Rate-limit / idempotency bypass
- Webhook signature forgery
- File-upload escapes (TUS resume tokens, storage adapter writes)
- Dependency CVEs that materially affect the template

## Out of scope

- Vulnerabilities in third-party libraries unless they materially
  affect the template's exposed surface (use `bun audit` to triage)
- Self-XSS that requires the victim to paste attacker-controlled
  payload into their own dev hub
- DoS that requires authenticated, privileged access
- Issues only reproducible on outdated Node / Bun versions
- Misconfiguration in consumer projects (e.g. `.env.example` left
  with placeholder values in production)

## Hardening checklist for consumers

If you ship a project on this template:

- [ ] `bun run setup` has replaced every `change-me-*` placeholder
- [ ] `BETTER_AUTH_SECRET` is ≥ 32 random bytes, rotated per environment
- [ ] `FIELD_ENCRYPTION_KEK` (when feature is on) is a separate value per environment
- [ ] CSP in production: no `cdn.jsdelivr.net` / `rsms.me` whitelist —
  self-host the assets (`src/core/http/security-headers.ts`)
- [ ] HSTS enabled (default in production CSP config)
- [ ] Rate-limit tuned for your traffic pattern (`AppModule:ThrottlerModule.forRoot`)
- [ ] `npm audit` or `bun audit` clean before each deploy
- [ ] Postgres RLS policies enabled on every tenant-scoped table
