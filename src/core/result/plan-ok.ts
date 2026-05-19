/**
 * Shared success marker for `{ ok: true }` discriminated unions.
 *
 * Use `return PLAN_OK` instead of inline success objects so the
 * disqualifier scan can enforce the pattern project-wide.
 */
export const PLAN_OK = { ok: true } as const;

export type PlanOk = typeof PLAN_OK;
