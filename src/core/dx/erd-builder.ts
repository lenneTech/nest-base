/**
 * Pure planner for `/hub/erd`.
 *
 * Parses a `schema.prisma` source string into a Mermaid `erDiagram`
 * suitable for rendering in the dev hub. We could shell out to a
 * generator like `prisma-erd-generator`, but parsing in-process keeps
 * the dev-loop fast (no Java, no chromium) and the planner pure.
 *
 * The parser is intentionally narrow: it understands `model X { ... }`
 * blocks and `field Type [@... ...]` declarations. Comments (`//`),
 * `@@map`, `@@unique`, etc. are stripped. The output preserves
 * source-order for deterministic diffs.
 *
 * What the renderer does NOT cover:
 *   - composite primary keys (`@@id([a, b])`) — Mermaid doesn't have
 *     a clean syntax for them; we ignore.
 *   - enums — rendered as plain types; the diagram is for shape, not
 *     full schema reproduction.
 */

export interface ErdPlan {
  /** Ready-to-embed Mermaid `erDiagram` source. */
  mermaid: string;
  modelCount: number;
  relationCount: number;
}

interface ErdField {
  name: string;
  type: string;
  isList: boolean;
  isOptional: boolean;
}

interface ErdModel {
  name: string;
  fields: ErdField[];
}

interface ErdRelation {
  from: string;
  to: string;
  /** Cardinality: `one-to-many` (FK on `from`), `many-to-many` (lists both sides). */
  kind: "one-to-many" | "many-to-many";
  fieldName: string;
}

const MODEL_BLOCK_RE = /\bmodel\s+(\w+)\s*\{([^}]*)\}/g;
const FIELD_RE = /^\s*(\w+)\s+(\S+)/;

export function buildErdFromSchema(source: string): ErdPlan {
  const stripped = stripComments(source);
  const models = parseModels(stripped);
  const relations = inferRelations(models);
  const mermaid = renderMermaid(models, relations);
  return {
    mermaid,
    modelCount: models.length,
    relationCount: relations.length,
  };
}

function stripComments(source: string): string {
  // Strip `//` line comments while preserving line endings so line
  // tracking stays sane during parsing.
  return source
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
}

function parseModels(source: string): ErdModel[] {
  const models: ErdModel[] = [];
  // `MODEL_BLOCK_RE` is global; reset state on each call.
  MODEL_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MODEL_BLOCK_RE.exec(source)) !== null) {
    const name = match[1];
    const body = match[2];
    if (!name || body === undefined) continue;
    const fields: ErdField[] = [];
    // Bodies can be single-line (`id String @id; name String`) or
    // multi-line. Split on both newlines and `;` (Prisma allows
    // semicolons as field separators in some formatters).
    const fieldLines = body
      .split(/\n|;/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("@@"));
    for (const line of fieldLines) {
      const fieldMatch = FIELD_RE.exec(line);
      if (!fieldMatch) continue;
      const [, fieldName, rawType] = fieldMatch;
      if (!fieldName || !rawType) continue;
      const isList = rawType.endsWith("[]");
      const isOptional = !isList && rawType.endsWith("?");
      const cleanType = rawType.replace(/[?[\]]/g, "");
      fields.push({ name: fieldName, type: cleanType, isList, isOptional });
    }
    models.push({ name, fields });
  }
  return models;
}

function inferRelations(models: ErdModel[]): ErdRelation[] {
  const modelNames = new Set(models.map((m) => m.name));
  const relations: ErdRelation[] = [];
  const seenManyToMany = new Set<string>();

  for (const model of models) {
    for (const field of model.fields) {
      if (!modelNames.has(field.type)) continue;
      // Skip self-references for now (Mermaid handles them but the
      // parser narrowness doesn't justify the complexity).
      if (field.type === model.name) continue;

      const otherModel = models.find((m) => m.name === field.type);
      if (!otherModel) continue;
      const otherSideHasList = otherModel.fields.some((f) => f.isList && f.type === model.name);

      if (field.isList && otherSideHasList) {
        // Many-to-many. Emit only once.
        const key = [model.name, otherModel.name].sort().join(":");
        if (seenManyToMany.has(key)) continue;
        seenManyToMany.add(key);
        relations.push({
          from: model.name,
          to: otherModel.name,
          kind: "many-to-many",
          fieldName: field.name,
        });
        continue;
      }

      if (!field.isList) {
        // FK side: `model.fk -> other`. Emit one-to-many.
        relations.push({
          from: model.name,
          to: otherModel.name,
          kind: "one-to-many",
          fieldName: field.name,
        });
      }
    }
  }
  return relations;
}

function renderMermaid(models: ErdModel[], relations: ErdRelation[]): string {
  const lines: string[] = ["erDiagram"];
  for (const model of models) {
    lines.push(`  ${model.name} {`);
    for (const field of model.fields) {
      // Skip relation fields (where type is another model and there
      // is no scalar value to render). A relation field has no `@db.*`
      // attribute and its type matches another model — show it as
      // `<Type> <name>` in the Mermaid attribute list.
      lines.push(`    ${field.type} ${field.name}`);
    }
    lines.push("  }");
  }
  for (const rel of relations) {
    if (rel.kind === "many-to-many") {
      lines.push(`  ${rel.from} }o--o{ ${rel.to} : ${rel.fieldName}`);
    } else {
      lines.push(`  ${rel.from} }o--|| ${rel.to} : ${rel.fieldName}`);
    }
  }
  return lines.join("\n");
}
