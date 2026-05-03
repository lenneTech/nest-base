/**
 * Pure planner for the RLS-coverage audit (LLM-test 2026-05-03 #3).
 *
 * Tenant isolation is the load-bearing guarantee of this template's
 * multi-tenant stack — every layer above (CASL abilities, the
 * `runWithRlsTenant` wrapper, the `tenant_isolation_<table>` policies)
 * assumes Postgres RLS is on for every tenant-scoped table.
 *
 * The friction: `bunx prisma migrate dev` will happily emit a
 * `CREATE TABLE` for a tenant-scoped model WITHOUT a sibling
 * `ALTER TABLE … ENABLE ROW LEVEL SECURITY`. Nothing fails, no
 * warning, the new table is wide open.
 *
 * This planner closes that gap. Given the merged Prisma schema source
 * and the migrations on disk, it returns one finding per tenant-
 * scoped model that has no RLS-enabling migration anywhere in the
 * tree. The runner half (`scripts/check-rls.ts`) wires the file I/O
 * and exits non-zero on findings — so the gate fails CI before a
 * tenant-leaky migration ships.
 *
 * The planner stays a pure function on purpose:
 *   - Re-runnable in tests with synthetic schemas + migrations,
 *   - No coupling to Prisma's runtime / migration engine,
 *   - Easy to extend (e.g. detect missing CREATE POLICY rows).
 *
 * Heuristics are intentionally narrow:
 *   - "Tenant-scoped" = the model block declares a `tenantId` field
 *     (any case for the leading `t`, must be a real field declaration
 *     — `tenantId String …`. SQL-style `tenant_id` references in
 *     `// comments` do NOT count).
 *   - "Has RLS migration" = at least one migration's SQL contains a
 *     case-insensitive, whitespace-tolerant
 *     `ALTER TABLE [<schema>.]<table-name> ENABLE ROW LEVEL SECURITY`
 *     for the model's resolved Postgres table (camel-to-snake or
 *     `@@map("…")` override).
 */

export interface RlsAuditPlannerInput {
  /** Full text of the Prisma schema (or merged feature schema). */
  schemaSource: string;
  /** Each migration as `{ name, sql }`. Order is irrelevant. */
  migrations: ReadonlyArray<{ name: string; sql: string }>;
}

export interface RlsAuditFinding {
  /** PascalCase Prisma model name. */
  model: string;
  /** Resolved Postgres table name (`@@map` if present, else snake_case(model)). */
  table: string;
  /** Number of migrations the planner scanned for this finding. */
  migrationsScanned: number;
}

/**
 * Inspect every model in `schemaSource`. For each model that declares
 * a `tenantId` field (i.e. is tenant-scoped), check whether any
 * migration's SQL enables RLS on the resolved table. Return one
 * finding per uncovered model.
 */
export function auditRlsCoverage(input: RlsAuditPlannerInput): RlsAuditFinding[] {
  const tenantScoped = listTenantScopedModels(input.schemaSource);
  const findings: RlsAuditFinding[] = [];
  for (const model of tenantScoped) {
    const covered = input.migrations.some((mig) => migrationEnablesRls(mig.sql, model.table));
    if (!covered) {
      findings.push({
        model: model.model,
        table: model.table,
        migrationsScanned: input.migrations.length,
      });
    }
  }
  return findings;
}

/**
 * Public helper: enumerate every tenant-scoped model in the schema
 * source. The runtime check (`scripts/check-rls.ts --runtime`) needs
 * the same list as the static audit but without the migration scan,
 * so we expose the model resolver as its own pure function rather
 * than duplicating the parser.
 */
export function listTenantScopedModels(
  schemaSource: string,
): ReadonlyArray<{ model: string; table: string }> {
  return parseModels(schemaSource)
    .filter((m) => m.hasTenantIdField)
    .map((m) => ({ model: m.name, table: m.table }));
}

// ─── Schema parsing ─────────────────────────────────────────────────

interface ParsedModel {
  name: string;
  /** Resolved Postgres table name (after applying `@@map`). */
  table: string;
  /** Does the model block declare a `tenantId` field? */
  hasTenantIdField: boolean;
}

/**
 * Walk every `model <Name> { … }` block in the schema source and
 * collect: the PascalCase model name, the resolved table name (via
 * `@@map("…")` if present, else `snake_case(name)`), and whether the
 * block contains a `tenantId` field declaration.
 *
 * The parser is regex-driven on purpose — Prisma's schema grammar is
 * simple enough for a hand-written walker, and dragging `@prisma/sdk`
 * (or shelling out to `prisma format`) into a CI gate would be
 * disproportionate. The planner only cares about three things per
 * model: the name, the `@@map`, and whether `tenantId` shows up.
 */
function parseModels(source: string): ParsedModel[] {
  const stripped = stripCommentsForFieldScan(source);
  const models: ParsedModel[] = [];
  const modelRegex = /\bmodel\s+(\w+)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = modelRegex.exec(stripped)) !== null) {
    const name = match[1];
    if (!name) continue;
    const braceOpen = match.index + match[0].length - 1;
    const braceClose = matchClosingBrace(stripped, braceOpen);
    if (braceClose < 0) continue;
    const body = stripped.slice(braceOpen + 1, braceClose);

    models.push({
      name,
      table: resolveTableName(name, body),
      hasTenantIdField: hasTenantIdFieldDeclaration(body),
    });

    // Skip past the model body so nested `{}` (rare but legal in
    // attribute arguments) cannot confuse the next iteration.
    modelRegex.lastIndex = braceClose + 1;
  }
  return models;
}

/**
 * Remove `//` line comments and `/* … *\/` block comments from the
 * source so that field-scan heuristics (e.g. `tenantId`) can't be
 * tricked by commented-out text. Preserves newlines so line numbers
 * (if ever added to findings) stay aligned.
 */
function stripCommentsForFieldScan(source: string): string {
  // Block comments first — replace with whitespace of equal length so
  // offsets stay roughly in sync with the original.
  let out = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  // Line comments next.
  out = out.replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
  return out;
}

function resolveTableName(modelName: string, body: string): string {
  const mapMatch = /@@map\s*\(\s*["']([^"']+)["']\s*\)/.exec(body);
  if (mapMatch?.[1]) return mapMatch[1];
  return pascalToSnake(modelName);
}

/**
 * `tenantId` is a Prisma field declaration of the form
 * `tenantId   String   @map("tenant_id") @db.Uuid`. Match that, and
 * only that — never an `@@index([tenantId])` or a SQL-style
 * `tenant_id` reference inside an attribute argument.
 */
function hasTenantIdFieldDeclaration(body: string): boolean {
  // Walk line-by-line. A field declaration starts with the field name
  // at the beginning of a line (modulo leading whitespace) and the
  // next token is the type. We only care that `tenantId` appears as
  // such an identifier.
  const lines = body.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("@@")) continue; // model-level attribute.
    // Pull the first identifier token.
    const tokenMatch = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
    if (!tokenMatch) continue;
    if (tokenMatch[1] === "tenantId") return true;
  }
  return false;
}

function pascalToSnake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function matchClosingBrace(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// ─── Migration scanning ─────────────────────────────────────────────

/**
 * Does `sql` enable RLS on `table`?
 *
 * The check is whitespace + quoting + case tolerant: `ALTER TABLE`
 * with any internal whitespace, the table name with or without
 * double-quotes (and optionally schema-qualified `public.<table>`),
 * any whitespace, then `ENABLE ROW LEVEL SECURITY`. Comments don't
 * count — we strip `--` line comments before searching.
 */
function migrationEnablesRls(sql: string, table: string): boolean {
  const stripped = stripSqlComments(sql);
  // Build a tolerant regex: optional schema, optional quoting, the
  // table name, then the keyword sequence with arbitrary whitespace.
  const tableEsc = escapeRegex(table);
  const re = new RegExp(
    String.raw`alter\s+table\s+(?:"?[A-Za-z_][A-Za-z0-9_]*"?\s*\.\s*)?"?` +
      tableEsc +
      String.raw`"?\s+enable\s+row\s+level\s+security\b`,
    "i",
  );
  return re.test(stripped);
}

function stripSqlComments(sql: string): string {
  // `--` to end-of-line.
  let out = sql.replace(/--[^\n]*/g, "");
  // `/* … */` block.
  out = out.replace(/\/\*[\s\S]*?\*\//g, "");
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
