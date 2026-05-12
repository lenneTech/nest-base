import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaService } from "../../src/core/prisma/prisma.service.js";
import { SEARCH_EXECUTORS } from "../../src/core/search/search.service.js";
import {
  PrismaUserSearchExecutor,
  buildUserSearchSql,
  sanitizeHighlight,
} from "../../src/core/search/user-search.executor.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
const USER_ALICE = "00000000-0000-0000-0000-000000000202";
const USER_BOB = "00000000-0000-0000-0000-000000000203";

/**
 * Story · default User search executor (CF.SEARCH.* — iter-96 review
 * Finding 17).
 *
 * The PRD pins "Postgres FTS + cross-resource search registry +
 * @Searchable decorator" + "tsquery diagnostics + ts_headline
 * highlighting". `SEARCH_EXECUTORS` shipped as `[]` — no executor
 * was wired. Iter-101 ships a Prisma-backed default for User:
 *
 *  1. `buildUserSearchSql({tsquery, limit})` — pure planner returns
 *     the parameterised SELECT with `ts_headline()` highlight + ts_rank
 *     ordering against `to_tsvector('simple', email || ' ' || name)`.
 *  2. `PrismaUserSearchExecutor` — implements `ResourceSearchExecutor`,
 *     compiles the user query into tsquery + runs the SELECT via
 *     `$queryRawUnsafe`, returns canonical SearchHit shape.
 *  3. SearchModule registers it under `SEARCH_EXECUTORS` so
 *     `/search?q=alice` returns highlighted hits out of the box.
 */
describe("Story · PrismaUserSearchExecutor", () => {
  describe("buildUserSearchSql (pure planner)", () => {
    it("includes ts_headline + ts_rank + LIMIT", () => {
      const sql = buildUserSearchSql({ limit: 10 });
      expect(sql).toContain("ts_headline");
      expect(sql).toContain("ts_rank");
      expect(sql).toContain("LIMIT");
      // Parameterisation: tsquery comes via $1, limit via $2.
      expect(sql).toContain("$1");
      expect(sql).toContain("$2");
    });

    it("queries the users table via to_tsvector(email + name)", () => {
      const sql = buildUserSearchSql({ limit: 10 });
      expect(sql).toContain("FROM users");
      expect(sql).toMatch(/to_tsvector/);
      expect(sql).toMatch(/email/);
      expect(sql).toMatch(/name/);
    });
  });

  describe("M2 fix: sanitizeHighlight — ts_headline XSS prevention", () => {
    it("passes plain text through unchanged (no special chars)", () => {
      expect(sanitizeHighlight("hello world")).toBe("hello world");
    });

    it("preserves <b>...</b> highlight markers from ts_headline", () => {
      expect(sanitizeHighlight("<b>alice</b>@example.com")).toBe("<b>alice</b>@example.com");
    });

    it("escapes < > & \" ' in user-controlled content", () => {
      const xss = '<script>alert("xss")</script>';
      const safe = sanitizeHighlight(xss);
      expect(safe).not.toContain("<script>");
      expect(safe).toContain("&lt;script&gt;");
    });

    it("allows ts_headline <b> tags but escapes other HTML", () => {
      // Simulate ts_headline output: user name contains < > but the match is wrapped in <b>
      const raw = "<b>ali</b>ce <evil>";
      const safe = sanitizeHighlight(raw);
      expect(safe).toContain("<b>ali</b>ce");
      expect(safe).toContain("&lt;evil&gt;");
      expect(safe).not.toContain("<evil>");
    });

    it("escapes ampersands to prevent double-encoding attacks", () => {
      const raw = "me &amp; you";
      const safe = sanitizeHighlight(raw);
      expect(safe).toBe("me &amp;amp; you");
    });
  });

  describe("end-to-end against Postgres testcontainer", () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let executor: PrismaUserSearchExecutor;

    beforeAll(async () => {
      process.env.FEATURE_SEARCH_ENABLED = "true";
      const { bootstrap } = await import("../../src/core/app/bootstrap.js");
      app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
      prisma = app.get(PrismaService);
      executor = new PrismaUserSearchExecutor(prisma);

      // After issue #118, the old `tenants` table was dropped and User.tenantId was
      // removed. Users are created without a tenant FK — no parent row needed.
      await prisma.user.upsert({
        where: { id: USER_ALICE },
        update: {},
        create: {
          id: USER_ALICE,
          email: `alice-${Date.now()}@example.com`,
          name: "Alice Anderson",
        },
      });
      await prisma.user.upsert({
        where: { id: USER_BOB },
        update: {},
        create: {
          id: USER_BOB,
          email: `bob-${Date.now()}@example.com`,
          name: "Bob Brown",
        },
      });
    });

    afterAll(async () => {
      if (prisma) {
        await prisma.user
          .deleteMany({ where: { id: { in: [USER_ALICE, USER_BOB] } } })
          .catch(() => undefined);
        // No tenant row to delete — tenants table was dropped in issue #118.
      }
      if (app) await app.close();
    });

    it("SEARCH_EXECUTORS contains a 'users' executor", () => {
      const executors = app.get<readonly { table: string }[]>(SEARCH_EXECUTORS);
      const tables = executors.map((e) => e.table);
      expect(tables).toContain("users");
    });

    it("table is 'users'", () => {
      expect(executor.table).toBe("users");
    });

    it("finds Alice by name and returns a SearchHit with rank + highlight", async () => {
      const hits = await executor.search("alice", 10);
      expect(hits.length).toBeGreaterThan(0);
      const aliceHit = hits.find((h) => h.id === USER_ALICE);
      expect(aliceHit).toBeDefined();
      expect(aliceHit?.resource).toBe("users");
      expect(aliceHit?.rank).toBeGreaterThan(0);
      expect(typeof aliceHit?.highlight).toBe("string");
      // ts_headline wraps matches with <b>...</b>; assert on the
      // structural shape so a future highlight-config change doesn't
      // silently fail.
      expect(aliceHit?.highlight ?? "").toContain("<b>");
    });

    it("returns no hits for a query that doesn't match any user", async () => {
      const hits = await executor.search("nonsensequeryterm", 10);
      const matches = hits.filter((h) => [USER_ALICE, USER_BOB].includes(h.id));
      expect(matches).toHaveLength(0);
    });

    it("respects the limit (≤ limit hits even when many users match)", async () => {
      const hits = await executor.search("anderson", 1);
      expect(hits.length).toBeLessThanOrEqual(1);
    });
  });
});
