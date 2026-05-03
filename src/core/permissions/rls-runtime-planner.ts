/**
 * Pure planner for the runtime half of the RLS-coverage audit.
 *
 * Why this exists alongside `rls-audit-planner.ts`: the static planner
 * only sees the migration files on disk, so a consumer who edits a
 * migration file *after* it has been applied will get a green static
 * scan even though `pg_class.relrowsecurity` on the live table is
 * `false`. RLS is the load-bearing tenant-isolation guarantee — every
 * `runWithRlsTenant` call assumes the policy actually fires — so we
 * also need a check that asks the database the truth.
 *
 * The runner half (`scripts/check-rls.ts`) connects to Postgres,
 * queries `pg_class` for `relrowsecurity` per table, and feeds the
 * `{ table -> bool }` map into this planner. Two failure modes are
 * reported as distinct `reason` values so the runner can render a
 * useful message:
 *   - `rls-disabled`  — row exists in `pg_class`, `relrowsecurity = false`.
 *   - `table-missing` — no row at all (migration never ran, or the
 *                       table lives in a non-public schema the runner
 *                       didn't query).
 *
 * The planner stays a pure function — no Prisma, no DB connection —
 * so it's trivially unit-testable with synthetic `dbState` snapshots.
 */

export interface RlsRuntimeModel {
  /** PascalCase Prisma model name (for the finding label). */
  model: string;
  /** Resolved Postgres table name (the `pg_class.relname` to look up). */
  table: string;
}

export interface RlsRuntimePlannerInput {
  /** All tenant-scoped models, resolved by the static planner first. */
  tenantScopedModels: ReadonlyArray<RlsRuntimeModel>;
  /**
   * Snapshot of `pg_class.relrowsecurity` keyed by `relname`. A missing
   * key means the row was not found (treated as `table-missing`).
   */
  dbState: Readonly<Record<string, boolean>>;
}

export type RlsRuntimeFindingReason = "rls-disabled" | "table-missing";

export interface RlsRuntimeFinding {
  model: string;
  table: string;
  reason: RlsRuntimeFindingReason;
}

/**
 * For each tenant-scoped model, look up its table in `dbState`. Emit
 * a finding when `relrowsecurity` is `false` (rls-disabled) or the
 * row is absent (table-missing). Empty `tenantScopedModels` short-
 * circuits to no findings — there's nothing to protect.
 */
export function auditRlsRuntime(input: RlsRuntimePlannerInput): RlsRuntimeFinding[] {
  const findings: RlsRuntimeFinding[] = [];
  for (const m of input.tenantScopedModels) {
    const has = Object.prototype.hasOwnProperty.call(input.dbState, m.table);
    if (!has) {
      findings.push({ model: m.model, table: m.table, reason: "table-missing" });
      continue;
    }
    if (input.dbState[m.table] !== true) {
      findings.push({ model: m.model, table: m.table, reason: "rls-disabled" });
    }
  }
  return findings;
}
