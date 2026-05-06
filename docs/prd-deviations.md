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
