# Security Contract — nest-base

This document is the substantive contract triad the PRD names at line 414:
**secret-management boundary**, **RLS contract**, **output-pipeline guarantees**.

It is the canonical answer to "where does plaintext live", "what
isolates one tenant from another", and "what can never appear in an
HTTP response body". Every claim here ties to a concrete file path
in `src/core/`; the doc is freshness-checked by the architecture
review, not by a runtime probe.

For vulnerability disclosure + the CI hardening checklist, see
[`SECURITY.md`](../SECURITY.md) (project root). For the route-level
permission audit, see [`docs/security/route-audit-2026-05-02.md`](./security/route-audit-2026-05-02.md).

## 1. Secret-management boundary

The server consumes seven categories of secret. Each has a single
documented input source, a single in-process owner, and a documented
rotation procedure.

| Secret | Env var | Owner | Storage | Rotation |
|---|---|---|---|---|
| Better-Auth signing key | `BETTER_AUTH_SECRET` | `src/core/auth/better-auth.ts:buildBetterAuth` | Process memory only | Generate fresh, redeploy; sessions invalidate |
| Encryption KEK (current) | `SECRET_KEK_HEX` (or `SECRET_KEK_<id>_HEX` for the multi-KEK rotation set) | `src/core/encryption/multi-kek.service.ts` | Process memory only | New KEK gets a new id; rotation runner walks rows + re-encrypts via DEK rewrap |
| HMAC blind-index key | `SECRET_HMAC_HEX` | `src/core/encryption/blind-index.ts:computeBlindIndex` | Process memory only | Fresh key requires re-indexing every searchable row (`scripts/migrate-blind-index.ts`) |
| Webhook signing secret | `WEBHOOK_SIGNING_SECRET` | `src/core/webhooks/hmac-signature.ts` | Process memory only | New secret invalidates active webhook verifications until subscribers update |
| Postgres credentials | `DATABASE_URL` | `src/core/prisma/prisma.service.ts` | Process memory only | Standard Postgres user rotation |
| Email driver credentials | `EMAIL_BREVO_API_KEY` / `EMAIL_SMTP_*` | `src/core/email/drivers/*.ts` | Process memory only | Provider-managed; restart picks up new env |
| MaxMind license key | `FEATURE_GEO_IP_LICENSE_KEY` | `src/core/geoip/download-runner.ts` | Process memory only | Provider-managed |

**Inviolable rules:**

1. **No secret reaches the database.** Every entry above is a *process input*. Secrets do not appear in any Prisma model, audit log, debug log, or `/dev/diagnostics` response. The output pipeline (§3) enforces this at the HTTP boundary as defense-in-depth.
2. **No secret in committed code or schema.** Repository-scoped scanners (oxlint + the CI secret-scan in `.github/workflows/`) flag any literal that matches the entropy + format of a known credential. The `.env.example` ships placeholder values explicitly named `change-me-*` so the env-prereqs runner (`src/core/setup/env-prerequisites.ts:97-106`) can flag a forgotten rotation.
3. **No secret in logs.** Pino's redaction set (`src/core/observability/init-pino.ts:redact`) and the output-pipeline safety net (`src/core/output-pipeline/safety-net.ts`) both cover the pattern set: `Authorization`, `cookie`, `password`, `token`, `secret`, `apiKey`, `authorization`, `set-cookie`, `BETTER_AUTH_SECRET`, `SECRET_*`, `*_TOKEN`, `*_API_KEY`. The realtime inspector applies the same masker (`src/core/realtime/inspector-filter.ts:maskPayload`) before any payload lands in the dev-only ringbuffer.
4. **At-rest encryption for personally-identifiable data.** Email, phone, and address fields are encrypted via the AES-256-GCM Prisma extension (`src/core/repository/prisma-extensions.ts` `fieldEncryption` extension + `src/core/encryption/field-encryption.service.ts`). The decrypted plaintext exists only inside the request handler's local scope; serializers project the plaintext via `select`-narrowing only on routes that explicitly need it. KEK rotation rewraps DEKs without re-encrypting payloads.

## 2. RLS contract

The Postgres layer enforces tenant isolation through Row-Level
Security policies set on every tenant-scoped table. The application
layer rides through them by setting a session-local
`app.current_tenant_id` GUC at the start of every transaction.

**File:** `src/core/multi-tenancy/tenant-guard.ts` (session GUC) +
`src/core/prisma/prisma.service.ts:runWithRlsTenant` (transaction
wrapper) + `prisma/schema.prisma` (per-table `RLS POLICY` clauses).

**The contract:**

1. **Every tenant-scoped table has RLS enabled.** A table with a
   `tenantId` column without `relrowsecurity = true` is a CI failure
   (`scripts/check-rls.ts` + `tests/stories/check-rls-loads-project-env.story.test.ts`).
2. **The policy is `tenantId = current_setting('app.current_tenant_id')::uuid`.** Set + reset around every request via `runWithRlsTenant`. Cross-tenant reads at the SQL layer return zero rows even with a malformed application-layer guard.
3. **Bypass requires explicit opt-in.** The audit-log writer is the only production code path that intentionally bypasses RLS — it uses the bare `PrismaClient` (not the extended client) because audit rows must be writable from any tenant context. The pattern is documented in `src/core/audit/audit-log.service.ts:11`.
4. **The tenant id arrives via three sources, in priority order:** (a) the `X-Tenant-Id` header (admin / impersonation paths only), (b) the session's `user.tenantId` (set on sign-in via Better-Auth's `databaseHooks.user.create.after`), (c) `null` (unauthenticated routes — only `@Public()` handlers and the health probes). The resolver lives in `src/core/multi-tenancy/resolve-request-tenant.ts` and is exercised by `tests/stories/resolve-request-tenant.story.test.ts`.
5. **Tenant exemptions are an allowlist.** `tenant-guard.ts` `EXEMPT_PREFIXES` / `EXEMPT_EXACT` paths skip the GUC set (e.g. `/health/*`, `/api/auth/*`, `/dev/*`). Adding to the allowlist is a deliberate cross-cutting decision; for a single route prefer `@Public("<reason>")`.

The RLS contract is verified end-to-end by `tests/multi-tenancy.e2e-spec.ts` + the cross-tenant breach test (`tests/stories/cross-tenant-write-breach.story.test.ts`). The story tests run against a real Postgres testcontainer so the policy text + the GUC dance are both exercised.

## 3. Output-pipeline guarantees

Every HTTP response goes through a four-stage interceptor chain
before the body is serialized to the client. The pipeline lives in
`src/core/output-pipeline/output-pipeline.ts:OutputPipeline.transform`
and is mounted globally in `src/core/app/bootstrap.ts`.

**The four stages, in order:**

1. **CASL field projection.** `src/core/output-pipeline/output-pipeline.ts:65-90` — for the response's resolved subject, the pipeline computes the union of `fields` declared on every CASL `read` rule the requester's ability holds for that subject. Fields outside the union are dropped from each row. An `[]` (or `undefined`) `fields` array is the explicit "no field-level constraint" signal — see `OPEN_QUESTIONS.md` for the rationale.
2. **Property masking.** `src/core/output-pipeline/output-pipeline.ts:92-110` — drops project-declared sensitive properties from every nested object via the `@MaskOnRead` decorator + the `OUTPUT_PIPELINE_MASKED_KEYS` registry. Used for fields that are queryable but never serializable (e.g. raw JWT, raw OTP, `lookupId` on api-keys).
3. **`removeSecrets`.** `src/core/output-pipeline/remove-secrets.ts` — recursive walk that drops any property whose key matches the secret-pattern set (case-insensitive): `password`, `token`, `secret`, `apikey`, `authorization`, `cookie`, `set-cookie`, `kek`, `dek`, `hmac`, `bearer`, `signing`. Used as defense-in-depth — the field projection (stage 1) already drops these on every well-permissioned route, but a forgotten rule (or a custom serializer that bypasses CASL) still gets caught.
4. **Safety net.** `src/core/output-pipeline/safety-net.ts` — pattern-match scan for known credential formats *anywhere* in the serialized JSON. Detects: JWT (`eyJ*.eyJ*.*`), Stripe live secret keys (`sk_live_*`), AWS access keys (`AKIA*`), GitHub PATs (`ghp_*`), OpenAI keys (`sk-proj-*` / `sk-*`), Better-Auth session tokens (32+ char base64 with the project's prefix). A match replaces the leaked substring with `[redacted:<class>]` and emits an audit-log event so the leak is investigable.

**Guarantees:**

- **No secret class slip-through.** The four-stage pipeline is exhaustive: any field present at the controller's response will be (a) authorised by CASL, (b) un-masked by `@MaskOnRead`, (c) free of secret-named properties, and (d) free of credential-shaped substrings. The five `tests/stories/safety-net-redacts-*.story.test.ts` tests lock the redactor's output for every known credential class (CI gate `SC.SUB.03-06`).
- **No silent failure.** The pipeline emits a structured log line on every redaction so the team sees a trail. A leak that bypasses all four stages is a documented escape — the decorator + registry are the two surfaces the team owns.
- **No performance hit on the hot path.** Stages 1-3 are O(rows × fields). Stage 4 is regex-batched + cached per response shape; the p95 budget assertion (`tests/p95-query-threshold.story.test.ts`) covers the pipeline's tail latency.

## How this document stays correct

Every PR that touches the secret list, an RLS policy, or the
pipeline's stage order updates this document in the same commit. The
[architecture review](./architecture.md) cross-checks file paths
quarterly. Drift is a CI failure: the
[`tests/stories/security-doc-freshness.story.test.ts`](../tests/stories/security-doc-freshness.story.test.ts)
story asserts that this document references all three contract
triads, anchors 13 representative source-file paths, and that every
anchored file exists on disk. Renaming `src/core/output-pipeline/safety-net.ts`
without updating this document is a CI failure.
