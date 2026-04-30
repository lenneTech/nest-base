import { describe, expect, it } from "vitest";

import {
  Searchable,
  SearchableRegistry,
  generateSearchMigration,
  getSearchableFields,
} from "../../src/core/search/searchable.js";

/**
 * Story · @Searchable + Migration-Generator.
 *
 *   class Project {
 *     @Searchable({ weight: 'A' })
 *     title: string;
 *
 *     @Searchable({ weight: 'B' })
 *     description: string;
 *   }
 *
 * The decorator stamps a per-class registry. The migration generator
 * walks the registry and emits the `<table>__search` tsvector column
 * plus a GIN index plus a trigger that keeps the column up to date.
 */
describe("Story · @Searchable + Migration-Generator", () => {
  describe("@Searchable() metadata", () => {
    it("collects fields per class via getSearchableFields()", () => {
      class Project {
        @Searchable({ weight: "A" })
        title!: string;
        @Searchable({ weight: "B" })
        description!: string;
      }
      const fields = getSearchableFields(Project);
      expect(fields.map((f) => f.field).sort()).toEqual(["description", "title"]);
      const titleField = fields.find((f) => f.field === "title")!;
      expect(titleField.weight).toBe("A");
    });

    it('defaults weight to "D" when not specified', () => {
      class Doc {
        @Searchable()
        body!: string;
      }
      const [field] = getSearchableFields(Doc);
      expect(field!.weight).toBe("D");
    });

    it("rejects unknown weights at decorator time", () => {
      expect(() => {
        class Bad {
          @Searchable({ weight: "Z" as never })
          x!: string;
        }
        void new Bad();
      }).toThrow(/weight/);
    });
  });

  describe("SearchableRegistry", () => {
    it("register() + listResources() returns every registered class", () => {
      class A {}
      class B {}
      const reg = new SearchableRegistry();
      reg.register("projects", A, [{ field: "title", weight: "A" }]);
      reg.register("docs", B, [{ field: "body", weight: "D" }]);
      expect(reg.listResources()).toEqual(["docs", "projects"]);
    });

    it("register() throws on a duplicate table name", () => {
      class A {}
      const reg = new SearchableRegistry();
      reg.register("projects", A, [{ field: "title", weight: "A" }]);
      expect(() => reg.register("projects", A, [{ field: "x", weight: "A" }])).toThrow(/projects/);
    });

    it("rejects empty fields list", () => {
      class A {}
      const reg = new SearchableRegistry();
      expect(() => reg.register("a", A, [])).toThrow(/fields/);
    });
  });

  describe("generateSearchMigration()", () => {
    it("emits the tsvector column, GIN index, trigger function, and trigger", () => {
      const sql = generateSearchMigration("projects", [
        { field: "title", weight: "A" },
        { field: "description", weight: "B" },
      ]);
      expect(sql).toMatch(/ALTER TABLE projects ADD COLUMN search tsvector/i);
      expect(sql).toMatch(/CREATE INDEX[\s\S]*USING GIN[\s\S]*search/i);
      expect(sql).toMatch(/CREATE FUNCTION[\s\S]*projects_search_trigger/i);
      expect(sql).toMatch(
        /setweight\(\s*to_tsvector\([\s\S]*'simple'[\s\S]*NEW\.title[\s\S]*'A'\s*\)/i,
      );
      expect(sql).toMatch(/setweight\(\s*to_tsvector\([\s\S]*NEW\.description[\s\S]*'B'\s*\)/i);
      expect(sql).toMatch(/CREATE TRIGGER projects_search_trigger/i);
    });

    it("uses the `simple` text-search dictionary by default", () => {
      const sql = generateSearchMigration("docs", [{ field: "body", weight: "D" }]);
      expect(sql).toMatch(/'simple'/);
    });

    it("escapes table + field names against SQL injection", () => {
      expect(() =>
        generateSearchMigration("foo; DROP TABLE users--", [{ field: "x", weight: "A" }]),
      ).toThrow(/identifier/i);
      expect(() => generateSearchMigration("foo", [{ field: 'x"; DROP', weight: "A" }])).toThrow(
        /identifier/i,
      );
    });
  });
});
