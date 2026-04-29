/**
 * PostgREST-Query-Parser → Prisma-WHERE (PLAN.md §22).
 *
 * Maps PostgREST-style query parameters to a Prisma `where` clause:
 *
 *   ?status=eq.published           → { status: 'published' }
 *   ?age=gte.18                    → { age: { gte: 18 } }
 *   ?status=in.(draft,published)   → { status: { in: ['draft', 'published'] } }
 *   ?deletedAt=is.null             → { deletedAt: null }
 *   ?name=ilike.%foo%              → { name: { contains: '%foo%', mode: 'insensitive' } }
 *
 * `combineWithAccessible()` AND-combines the user filter with the
 * ability-derived filter so RLS + permissions + user filter are
 * applied as one query.
 */

export type PrismaWhereValue =
  | string
  | number
  | boolean
  | null
  | { in: unknown[] }
  | { not: unknown }
  | { gt: unknown }
  | { gte: unknown }
  | { lt: unknown }
  | { lte: unknown }
  | { contains: string; mode?: "insensitive" };

export type PrismaWhere = Record<string, PrismaWhereValue>;

const SUPPORTED_OPERATORS = new Set([
  "eq",
  "neq",
  "lt",
  "lte",
  "gt",
  "gte",
  "in",
  "is",
  "like",
  "ilike",
]);

export function parsePostgrestQuery(query: Record<string, string>): PrismaWhere {
  const where: PrismaWhere = {};
  for (const [field, raw] of Object.entries(query)) {
    where[field] = parseExpression(raw);
  }
  return where;
}

function parseExpression(raw: string): PrismaWhereValue {
  const dot = raw.indexOf(".");
  if (dot < 0) throw new Error(`postgrest-query: missing operator in expression "${raw}"`);
  const op = raw.slice(0, dot);
  const value = raw.slice(dot + 1);

  if (!SUPPORTED_OPERATORS.has(op)) {
    throw new Error(`postgrest-query: unsupported operator "${op}"`);
  }

  switch (op) {
    case "eq":
      return coerce(value);
    case "neq":
      return { not: coerce(value) };
    case "lt":
      return { lt: coerce(value) };
    case "lte":
      return { lte: coerce(value) };
    case "gt":
      return { gt: coerce(value) };
    case "gte":
      return { gte: coerce(value) };
    case "in":
      return { in: parseInList(value) };
    case "is":
      if (value === "null") return null;
      if (value === "not_null") return { not: null };
      throw new Error(`postgrest-query: unsupported is.<value> "${value}"`);
    case "like":
      return { contains: value };
    case "ilike":
      return { contains: value, mode: "insensitive" };
    default:
      // Unreachable thanks to SUPPORTED_OPERATORS guard above.
      throw new Error(`postgrest-query: missing handler for operator "${op}"`);
  }
}

function parseInList(value: string): unknown[] {
  const trimmed = value.startsWith("(") && value.endsWith(")") ? value.slice(1, -1) : value;
  return trimmed.split(",").map((item) => coerce(item.trim()));
}

function coerce(value: string): string | number | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^-?\d+\.\d+$/.test(value)) return Number(value);
  return value;
}

export function combineWithAccessible(
  userFilter: Record<string, unknown>,
  abilityFilter: Record<string, unknown>,
): { AND: Record<string, unknown>[] } {
  return { AND: [userFilter, abilityFilter] };
}
