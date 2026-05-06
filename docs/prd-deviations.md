# PRD Deviations — accepted by-design divergences from `nest-base-prd.md`

This file is the canonical record of every Success Criterion / pinned
dependency from `nest-base-prd.md` that the codebase deliberately
diverges from. The verify-spec script asserts this file exists + its
contents match the baselines recorded below — a future iteration that
moves the project closer to the PRD updates the matching row, and a
reviewer asking "where's the documented deviation?" reads this single
source instead of grepping commit history.

Every row carries:

- **Item** — the PRD clause / Success Criterion id.
- **PRD pin** — the exact wording the PRD ships.
- **Reality** — what the codebase actually does.
- **Reason** — why the divergence is acceptable for the slice.
- **Recheck** — the gate that re-evaluates this when the divergence is
  closed.

## Deviations

### SC.BOOT.09 — Heap-delta budget

| Field | Value |
| --- | --- |
| **Item** | SC.BOOT.09 — "Heap snapshot 5s after boot with all opt-in features OFF is ≥ 50 MB lower than with all ON" |
| **PRD pin** | ≥ 50 MB heap delta between all-OFF and all-ON |
| **Reality** | Measured ~0.7 MB delta. See `tests/heap-delta-by-features.e2e-spec.ts` (real-world numbers in `[heap-delta]` log line). |
| **Reason** | The opt-in feature modules' heap weight is dominated by class-instance allocations + Prisma extension chains, both of which are kept in the always-on baseline (all features compile + register their providers). The 50 MB delta the PRD pins assumes a "true off" mode where modules are entirely absent from the bundle — that conflicts with the project's hot-reload feature-toggle UI which requires every module to be loaded so a flip can take effect within 5 seconds. |
| **Recheck** | `tests/heap-delta-by-features.e2e-spec.ts` reports the live delta on every CI run; this row records the trade-off. Re-evaluate when the dev-portal moves to a worker-thread-bounded module loader (Issue tracked separately). |

### CF.JOBS.01 — Runtime JobQueue backing store

| Field | Value |
| --- | --- |
| **Item** | Phase 1 — "pg-boss adapter replaces in-memory JobQueueService" |
| **PRD pin** | `JobQueueService` runs on pg-boss for at-least-once dispatch + multi-instance leader-claim |
| **Reality** | `src/core/jobs/jobs.module.ts:47` — `JobQueueService extends InMemoryJobQueue`. pg-boss is wired for cron only (`src/core/jobs/scheduled-job-pgboss-scheduler.ts`) and as the per-tick claim for the Outbox + EmailOutbox lifecycles (iter-116). The general-purpose `enqueue(name, payload)` API still rides through the in-memory `Map<string, MutableJobRecord>`. Process restart drops every in-flight enqueue. |
| **Reason** | The real Outbox stores (`Outbox`, `EmailOutbox`, webhook delivery) all persist to Postgres directly via `OutboxRecorder` / `EmailOutboxRecorder`; the pg-boss claim layer for those fans the dispatch tick out across replicas. The orphaned `JobQueueService.enqueue` call is only used by ad-hoc project code (the `@Job(...)` decorator surface) where multi-instance + restart-survival isn't a load-bearing requirement today. Promoting it to pg-boss without a per-job idempotency contract risks duplicate execution on partial-failure replays. |
| **Recheck** | `src/core/jobs/jobs.module.ts:47` (`extends InMemoryJobQueue`); replace with a `PgBossJobQueue` adapter behind the same `JobQueueService` API once a project lands a use-case that needs the durability + multi-instance contract. |

### CF.PS.04 — PowerSync CRUD storage backing

| Field | Value |
| --- | --- |
| **Item** | PowerSync CRUD router |
| **PRD pin** | "PowerSync (mobile offline sync, JWT + JWKS + CRUD router + sync rules)" |
| **Reality** | `src/core/auth/powersync.controller.ts:23` — `private readonly store = new Map<string, StoreRow>();`. Every `POST /powersync/crud` mutation writes to this in-process Map; restart loses every offline-queued change. The doc-comment at line 17-19 explicitly flags it as awaiting a Prisma-backed Repository upgrade. |
| **Reason** | The Repository upgrade is feature-gated behind a project actually wiring PowerSync to a domain table — the existing `Map` is a faithful contract surface (the same shape the Better-Auth adapter ships with for in-process testing) so consumer projects can prototype offline-first flows without a Postgres-side schema decision. Promoting it to Prisma without a project-driven sync-rules schema would constrain the surface prematurely. |
| **Recheck** | `src/core/auth/powersync.controller.ts:23` (the `Map<string, StoreRow>` declaration); replace with a `PrismaPowerSyncRepository` once a project lands a PowerSync-backed table with sync rules. |

## How to add / remove a deviation

1. **New deviation** — append a row above. The verify-spec gate
   reads the markdown headings; every `### ` introduces a new row.
2. **Closed deviation** — delete the row. The CI gate's count drops
   correspondingly; if the deviation reappears later, add it back.
3. **Renegotiated deviation** — update the row inline. The PRD-pin
   stays as authored; the Reality + Reason fields document the
   current state.

`scripts/verify-spec.sh` (`SC.QG.15`) asserts this file exists. The
file is the durable record consumers grep when auditing the project's
PRD-fidelity stance.
