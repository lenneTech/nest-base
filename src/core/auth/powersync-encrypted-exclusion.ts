/**
 * Encrypted-fields exclusion for PowerSync sync-rules
 *.
 *
 * The Postgres logical publication is permissive (FOR ALL TABLES) on
 * purpose — sync-rules.yaml is the single enforcement point that picks
 * which *columns* reach mobile clients.  Two helpers belong to that
 * boundary:
 *
 *   - `buildSyncSelectExcludingEncrypted(allColumns, encryptedColumns)`
 *     produces the explicit column list a sync-rule data query should
 *     use.  Throws if an encrypted column is missing from the column
 *     set (typo guard).
 *
 *   - `assertSyncRulesExcludeEncrypted(yamlText, registry)` scans the
 *     live YAML and refuses any data query that references a column
 *     declared encrypted for that table.  Used as a regression test
 *     and in CI guardrails.
 */

export type EncryptedFieldRegistry = Readonly<Record<string, ReadonlyArray<string>>>;

export function buildSyncSelectExcludingEncrypted(
  allColumns: ReadonlyArray<string>,
  encryptedColumns: ReadonlyArray<string>,
): string[] {
  if (allColumns.length === 0) {
    throw new Error("powersync-encrypted-exclusion: at least one column is required");
  }
  const allSet = new Set(allColumns);
  for (const col of encryptedColumns) {
    if (!allSet.has(col)) {
      throw new Error(
        `powersync-encrypted-exclusion: encrypted column "${col}" is not in the column list (typo?)`,
      );
    }
  }
  const blocked = new Set(encryptedColumns);
  return allColumns.filter((c) => !blocked.has(c));
}

export function assertSyncRulesExcludeEncrypted(
  yamlText: string,
  registry: EncryptedFieldRegistry,
): void {
  for (const [table, columns] of Object.entries(registry)) {
    // Look for `FROM <table>` (case-insensitive) in any sync-rule body
    // followed by a SELECT that mentions a forbidden column.
    const tableRegex = new RegExp(`SELECT[\\s\\S]*?FROM\\s+${escapeRegex(table)}\\b`, "gi");
    const selects = matchAll(yamlText, tableRegex).map((m) => m[0]);
    for (const selectClause of selects) {
      for (const col of columns) {
        const colRegex = new RegExp(`\\b${escapeRegex(col)}\\b`);
        if (colRegex.test(selectClause)) {
          throw new Error(
            `powersync-encrypted-exclusion: ${table}.${col} is encrypted and must not appear in sync-rules`,
          );
        }
      }
    }
  }
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchAll(input: string, regex: RegExp): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  while ((match = re.exec(input)) !== null) {
    out.push(match);
    if (match.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}
