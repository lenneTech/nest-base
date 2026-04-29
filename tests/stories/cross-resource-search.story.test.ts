import { describe, expect, it } from "vitest";

import {
  CrossResourceSearchService,
  type ResourceSearchExecutor,
  type SearchHit,
} from "../../src/core/search/cross-resource-search.js";

/**
 * Story · Cross-Resource Search (PLAN.md §11 + §32 Phase 5).
 *
 * One endpoint, many resources. The orchestrator fans the sanitized
 * query out to every registered resource executor (one per
 * Searchable-registered table), aggregates the hits, sorts by rank
 * descending, then trims to the requested limit.
 *
 * The executors are injectable so the unit suite stays DB-free; the
 * production binding wraps Prisma `$queryRaw` calls per resource.
 */
describe("Story · Cross-Resource Search", () => {
  function makeExecutor(
    table: string,
    hits: Array<{ id: string; rank: number; title?: string }>,
  ): ResourceSearchExecutor {
    return {
      table,
      async search(query, limit) {
        return hits.slice(0, limit).map<SearchHit>((h) => ({
          resource: table,
          id: h.id,
          rank: h.rank,
          highlight: h.title ?? `${query}-match`,
        }));
      },
    };
  }

  it("queries every executor and merges results", async () => {
    const svc = new CrossResourceSearchService([
      makeExecutor("projects", [{ id: "p1", rank: 0.5 }]),
      makeExecutor("files", [{ id: "f1", rank: 0.3 }]),
    ]);
    const hits = await svc.search("hello", { limit: 10 });
    expect(hits.map((h) => h.id).sort()).toEqual(["f1", "p1"]);
  });

  it("sorts hits by rank descending", async () => {
    const svc = new CrossResourceSearchService([
      makeExecutor("a", [{ id: "a1", rank: 0.1 }]),
      makeExecutor("b", [{ id: "b1", rank: 0.9 }]),
      makeExecutor("c", [{ id: "c1", rank: 0.5 }]),
    ]);
    const hits = await svc.search("hello", { limit: 10 });
    expect(hits.map((h) => h.id)).toEqual(["b1", "c1", "a1"]);
  });

  it("honors the limit across the merged set", async () => {
    const svc = new CrossResourceSearchService([
      makeExecutor("a", [
        { id: "a1", rank: 0.9 },
        { id: "a2", rank: 0.8 },
      ]),
      makeExecutor("b", [
        { id: "b1", rank: 0.7 },
        { id: "b2", rank: 0.6 },
      ]),
    ]);
    const hits = await svc.search("hello", { limit: 2 });
    expect(hits.map((h) => h.id)).toEqual(["a1", "a2"]);
  });

  it("passes the per-resource limit to each executor", async () => {
    const calls: Array<{ table: string; limit: number }> = [];
    const executors: ResourceSearchExecutor[] = [
      {
        table: "t",
        async search(_q, limit) {
          calls.push({ table: "t", limit });
          return [];
        },
      },
    ];
    const svc = new CrossResourceSearchService(executors);
    await svc.search("hello", { limit: 5 });
    expect(calls).toEqual([{ table: "t", limit: 5 }]);
  });

  it("rejects an empty query (after sanitization)", async () => {
    const svc = new CrossResourceSearchService([makeExecutor("t", [])]);
    await expect(svc.search("", { limit: 10 })).rejects.toThrow();
    await expect(svc.search("  &|!  ", { limit: 10 })).rejects.toThrow();
  });

  it("rejects non-positive limits", async () => {
    const svc = new CrossResourceSearchService([makeExecutor("t", [])]);
    await expect(svc.search("hello", { limit: 0 })).rejects.toThrow();
    await expect(svc.search("hello", { limit: -1 })).rejects.toThrow();
  });

  it("accepts an `only` allowlist that restricts which executors run", async () => {
    const calls: string[] = [];
    const executors: ResourceSearchExecutor[] = [
      {
        table: "projects",
        async search() {
          calls.push("projects");
          return [];
        },
      },
      {
        table: "files",
        async search() {
          calls.push("files");
          return [];
        },
      },
    ];
    const svc = new CrossResourceSearchService(executors);
    await svc.search("hello", { limit: 10, only: ["files"] });
    expect(calls).toEqual(["files"]);
  });

  it("returns [] when no executor produces hits", async () => {
    const svc = new CrossResourceSearchService([makeExecutor("a", []), makeExecutor("b", [])]);
    expect(await svc.search("nothing", { limit: 10 })).toEqual([]);
  });
});
