import { describe, expect, it } from "vitest";

import { buildErdFromSchema } from "../../src/core/dx/erd-builder.js";

/**
 * Story · `/hub/erd` — Prisma ERD viewer.
 *
 * Pure planner that reads a `schema.prisma` source string and emits
 * a Mermaid `erDiagram` representation. The runner side
 * (file-system read + caching) lives in `erd-runner.ts`.
 *
 * Test surface: parsing models, picking up relations, ignoring
 * comments, escaping reserved Mermaid characters.
 */
describe("Story · buildErdFromSchema", () => {
  it("renders a single model as a Mermaid block", () => {
    const schema = `
model User {
  id    String @id @default(uuid()) @db.Uuid
  email String @unique
}
`;
    const erd = buildErdFromSchema(schema);
    expect(erd.mermaid).toContain("erDiagram");
    expect(erd.mermaid).toContain("User {");
    expect(erd.mermaid).toContain("String id");
    expect(erd.mermaid).toContain("String email");
    expect(erd.modelCount).toBe(1);
  });

  it("emits a relation arrow for foreign-key columns", () => {
    const schema = `
model Tenant {
  id   String @id @default(uuid()) @db.Uuid
  name String
  users User[]
}

model User {
  id       String @id @default(uuid()) @db.Uuid
  email    String
  tenantId String @map("tenant_id") @db.Uuid
  tenant   Tenant @relation(fields: [tenantId], references: [id])
}
`;
    const erd = buildErdFromSchema(schema);
    // Mermaid relation: "User }o--|| Tenant : tenant"
    expect(erd.mermaid).toMatch(/User\s+\}o--\|\|\s+Tenant/);
    expect(erd.relationCount).toBe(1);
  });

  it("emits a many-to-many relation when both sides are list-typed", () => {
    const schema = `
model Tag {
  id    String @id
  posts Post[]
}

model Post {
  id   String @id
  tags Tag[]
}
`;
    const erd = buildErdFromSchema(schema);
    // List-on-both-sides → many-to-many
    expect(erd.mermaid).toMatch(/Post\s+\}o--o\{\s+Tag|Tag\s+\}o--o\{\s+Post/);
  });

  it("ignores `//` line comments and `@@map` directives", () => {
    const schema = `
// This is a comment

model Project {
  id   String @id  // inline comment
  name String

  @@map("projects")
}
`;
    const erd = buildErdFromSchema(schema);
    expect(erd.mermaid).not.toContain("This is a comment");
    expect(erd.mermaid).not.toContain("@@map");
    expect(erd.mermaid).toContain("Project {");
  });

  it("strips Prisma-specific decorators from field types in the diagram", () => {
    const schema = `
model File {
  id        String   @id @default(uuid()) @db.Uuid
  body      Bytes
  createdAt DateTime @default(now())
}
`;
    const erd = buildErdFromSchema(schema);
    expect(erd.mermaid).toContain("String id");
    expect(erd.mermaid).toContain("Bytes body");
    expect(erd.mermaid).toContain("DateTime createdAt");
    // No @id, @default, @db.Uuid in the rendered output
    expect(erd.mermaid).not.toContain("@id");
    expect(erd.mermaid).not.toContain("@default");
    expect(erd.mermaid).not.toContain("@db.Uuid");
  });

  it("returns 0 model and relation counts for an empty schema", () => {
    const erd = buildErdFromSchema("// empty");
    expect(erd.modelCount).toBe(0);
    expect(erd.relationCount).toBe(0);
    expect(erd.mermaid).toContain("erDiagram");
  });

  it("preserves model order from the source for deterministic output", () => {
    const schema = `
model B { id String @id }
model A { id String @id }
model C { id String @id }
`;
    const erd = buildErdFromSchema(schema);
    const order = ["B {", "A {", "C {"];
    let lastIndex = -1;
    for (const marker of order) {
      const idx = erd.mermaid.indexOf(marker);
      expect(idx).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    }
  });

  it("collapses optional + array markers in the rendered field type", () => {
    const schema = `
model X {
  id     String   @id
  tags   String[]
  parent X?
}
`;
    const erd = buildErdFromSchema(schema);
    // The Mermaid syntax doesn't support `?` or `[]` in types — they
    // must be collapsed to plain identifiers.
    expect(erd.mermaid).not.toContain("String[]");
    expect(erd.mermaid).not.toContain("X?");
    expect(erd.mermaid).toContain("String tags");
    expect(erd.mermaid).toContain("X parent");
  });
});
