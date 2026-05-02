import type { AbilityRule } from "./casl-ability.js";

/**
 * DB-Rule → CASL-Rule resolver.
 *
 * Persisted Permission rows speak Directus-flavored filter DSL with
 * variables (`$CURRENT_USER`, `$CURRENT_TENANT`, `$NOW`). The resolver:
 *   1. lowercases PermissionAction (`READ` → `'read'`)
 *   2. translates Directus operators to MongoDB-query operators that
 *      CASL's `mongoQueryMatcher` consumes (`_neq` → `$ne`, `_in` →
 *      `$in`, …)
 *   3. substitutes the supported variables against the request context
 *   4. propagates the field-allowlist verbatim
 *
 * The 1:1 between Directus DSL and the persisted shape is intentional —
 * the admin UI authors rules in DSL form, the API consumes the resolved
 * form. Single source of truth for the operator vocabulary lives here.
 */

// `MANAGE` is not in the `PermissionAction` SQL enum — it only appears
// on synthesized in-memory rows produced by `buildMemberRoleRules()`.
// The resolver lowercases it to `'manage'`, which CASL treats as the
// CRUD wildcard.
export type DbAction = "CREATE" | "READ" | "UPDATE" | "DELETE" | "SHARE" | "MANAGE";

export interface DbPermissionRow {
  resource: string;
  action: DbAction;
  itemFilter: Record<string, unknown> | null;
  fields: string[];
}

export interface ResolveContext {
  userId: string;
  now: Date;
  /**
   * Active tenant id. When set, every `$CURRENT_TENANT` literal in
   * `itemFilter` is substituted with this value. Optional for back-
   * compat with callers that built the context before the variable
   * was defined — those see `$CURRENT_TENANT` as a literal string
   * which naturally fails to match any real row (safe default).
   */
  tenantId?: string;
}

const OPERATOR_MAP: Record<string, string | null> = {
  // null = strip operator wrapper, take the bare value (CASL field-equality)
  _eq: null,
  _neq: "$ne",
  _in: "$in",
  _nin: "$nin",
  _lt: "$lt",
  _lte: "$lte",
  _gt: "$gt",
  _gte: "$gte",
};

const VAR_CURRENT_USER = "$CURRENT_USER";
const VAR_CURRENT_TENANT = "$CURRENT_TENANT";
const VAR_NOW = "$NOW";

export function resolveDbRules(rows: DbPermissionRow[], ctx: ResolveContext): AbilityRule[] {
  return rows.map((row) => {
    const rule: AbilityRule = {
      action: row.action.toLowerCase(),
      subject: row.resource,
      fields: row.fields,
    };
    if (row.itemFilter) {
      rule.conditions = resolveFilter(row.itemFilter, ctx);
    }
    return rule;
  });
}

function resolveFilter(
  filter: Record<string, unknown>,
  ctx: ResolveContext,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, raw] of Object.entries(filter)) {
    out[field] = resolveFieldFilter(raw, ctx);
  }
  return out;
}

function resolveFieldFilter(raw: unknown, ctx: ResolveContext): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return substituteValue(raw, ctx);
  }
  const ops = raw as Record<string, unknown>;
  const entries = Object.entries(ops);
  // Special-case: a single _eq → bare value (CASL field-equality).
  if (entries.length === 1 && entries[0]![0] === "_eq") {
    return substituteValue(entries[0]![1], ctx);
  }
  const out: Record<string, unknown> = {};
  for (const [op, value] of entries) {
    if (!(op in OPERATOR_MAP)) {
      throw new Error(
        `db-rule-resolver: unsupported operator "${op}" — extend OPERATOR_MAP if intentional`,
      );
    }
    const mapped = OPERATOR_MAP[op];
    if (mapped === null) {
      // Should only happen via _eq alone, but handle defensively.
      out[op] = substituteValue(value, ctx);
    } else {
      out[mapped] = substituteValue(value, ctx);
    }
  }
  return out;
}

function substituteValue(value: unknown, ctx: ResolveContext): unknown {
  if (Array.isArray(value)) return value.map((item) => substituteValue(item, ctx));
  if (value === VAR_CURRENT_USER) return ctx.userId;
  // `$CURRENT_TENANT` only substitutes when a tenant id is present in
  // the context. Legacy callers (no tenantId) get the literal back —
  // CASL will compare it to the row's `tenantId` and naturally fail,
  // which is a safe failure mode rather than a silent grant.
  if (value === VAR_CURRENT_TENANT && ctx.tenantId !== undefined) return ctx.tenantId;
  if (value === VAR_NOW) return ctx.now.toISOString();
  return value;
}
