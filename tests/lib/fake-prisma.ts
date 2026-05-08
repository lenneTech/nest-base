/**
 * In-memory PrismaService stand-in for fast story tests.
 *
 * Why this exists:
 *
 * The slim module pattern (`src/modules/<x>/<x>.service.ts` calls
 * `prisma.<table>.<method>()` directly) drops the explicit Repository
 * abstraction. That keeps production code shorter, but tests still
 * need a way to exercise the service WITHOUT booting a Postgres
 * testcontainer for every assertion. This helper is the answer: a
 * fake `PrismaService` whose tables are `Map<id, row>` objects in
 * memory.
 *
 * What's emulated:
 *   - `runWithRlsTenant(cb, tenantId)` — calls the callback with
 *     `this` as the tx; tenant scoping is enforced by the service
 *     (filtering `tenantId` on every read).
 *   - Per table: `create`, `findUnique`, `findMany`, `update`,
 *     `delete`. Auto-fills `createdAt` / `updatedAt` as `Date` on
 *     create, bumps `updatedAt` on update — matching the real
 *     Prisma `@default(now())` / `@updatedAt` semantics.
 *
 * The helper is intentionally narrow. It doesn't try to be Prisma
 * — it's the smallest contract that lets the service code run
 * unmodified against in-memory data.
 *
 * Extensibility — Proxy auto-table:
 *
 * Project-owned `src/modules/<x>/` resources need to story-test their
 * services without force-editing this template-owned file (that would
 * make every upstream sync a hot-spot). The fake is therefore wrapped
 * in a `Proxy` that lazily creates a `TableMock` the first time a
 * spec accesses a previously-unknown property. Calls like
 * `fake.todo.create(...)` work without registration. The `example`
 * and `userProfile` mocks remain pre-seeded for backwards
 * compatibility with existing story tests.
 *
 * undefined vs null — Row value access:
 *
 * Real Prisma returns `null` for optional columns that were not set.
 * This fake stores `undefined` for those same columns (plain JS object
 * spread). Service code that reads row values MUST use loose-equality
 * checks: `record.deletedAt != null` (treats both undefined and null as
 * "not set"). Using strict `!== null` returns true for undefined fields
 * and causes incorrect "not found" errors in soft-delete guards.
 * WHERE-clause comparisons are already normalised inside matchesWhere —
 * only direct row field access is affected.
 */

import { uuidV7 } from "../../src/core/uuid/uuid-v7.js";
import type { PrismaService } from "../../src/core/prisma/prisma.service.js";

type Row = Record<string, unknown> & {
  id: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface TableMock<T extends Row> {
  /**
   * `data.id` is optional in the fake. `dbgenerated("uuid_generate_v7()")`
   * is server-side only — Prisma client never computes it client-side,
   * so the fake fills the gap by auto-injecting a fresh `uuidV7()` when
   * the caller omits the id (or passes it as `undefined`). Callers that
   * supply an explicit id keep their value untouched.
   */
  create(input: { data: Partial<T> }): Promise<T>;
  findUnique(input: { where: Partial<T> }): Promise<T | null>;
  findMany(input?: {
    where?: Partial<T>;
    orderBy?: { [k: string]: "asc" | "desc" } | Array<{ [k: string]: "asc" | "desc" }>;
    /** Number of rows to discard from the start of the filtered+ordered result. */
    skip?: number;
    /** Maximum number of rows to return after the skip. */
    take?: number;
  }): Promise<T[]>;
  /** Returns the number of rows that match `where` (no pagination slicing). */
  count(input?: { where?: Partial<T> }): Promise<number>;
  update(input: { where: Partial<T>; data: Partial<T> }): Promise<T>;
  delete(input: { where: Partial<T> }): Promise<T>;
  /** Test-only: clear all rows. Use in `beforeEach` to reset state. */
  __reset(): void;
}

function makeTable<T extends Row>(): TableMock<T> {
  const rows = new Map<string, T>();

  const matchesWhere = (row: T, where: Partial<T>): boolean => {
    for (const [key, value] of Object.entries(where)) {
      const rowValue = row[key as keyof T];
      // Real Prisma + Postgres treat `where: { col: null }` and
      // "column was never assigned on insert" identically, because the
      // column defaults to NULL. The naive `!==` check excluded rows
      // whose column was undefined — silently breaking
      // `findMany({ where: { deletedAt: null } })` for soft-delete
      // services. Normalise `undefined → null` for filter comparison
      // only — the row's stored shape is left untouched. (friction-log
      // 2026-05-03)
      const a = rowValue === undefined ? null : rowValue;
      const b = value === undefined ? null : value;
      if (a !== b) return false;
    }
    return true;
  };

  const findFirst = (where: Partial<T>): T | undefined => {
    for (const row of rows.values()) {
      if (matchesWhere(row, where)) return row;
    }
    return undefined;
  };

  return {
    async create({ data }) {
      // Auto-fill timestamps the way Prisma does via `@default(now())`
      // / `@updatedAt`, but let the caller override (some callers want
      // deterministic timestamps for assertions).
      const now = new Date();
      // `dbgenerated("uuid_generate_v7()")` runs server-side only;
      // Prisma client never computes it on `create`. The fake stands
      // in for that path so story tests can omit `id` the same way
      // production code does and still have a stable lookup key for
      // chained `findUnique` / `update` / `delete` calls.
      const dataObj = data as Partial<T> & { id?: string };
      const id = dataObj.id ?? uuidV7();
      const row = {
        createdAt: now,
        updatedAt: now,
        ...data,
        id,
      } as T;
      rows.set(row.id, row);
      return row;
    },
    async findUnique({ where }) {
      return findFirst(where) ?? null;
    },
    async findMany(input = {}) {
      let result = [...rows.values()];
      if (input.where) result = result.filter((r) => matchesWhere(r, input.where!));
      const orderByList = Array.isArray(input.orderBy)
        ? input.orderBy
        : input.orderBy
          ? [input.orderBy]
          : [];
      for (const clause of orderByList.reverse()) {
        const [key, direction] = Object.entries(clause)[0] ?? [];
        if (!key) continue;
        result.sort((a, b) => {
          const av = a[key as keyof T];
          const bv = b[key as keyof T];
          const compare =
            av instanceof Date && bv instanceof Date
              ? av.getTime() - bv.getTime()
              : String(av).localeCompare(String(bv));
          return direction === "desc" ? -compare : compare;
        });
      }
      // Pagination is applied AFTER where + orderBy so the slice
      // matches what real Prisma + Postgres would yield. `skip`
      // defaults to 0 and `take` to "no upper bound" — passing
      // neither must keep the legacy "return all matching rows"
      // behaviour.
      const skip = typeof input.skip === "number" && input.skip > 0 ? input.skip : 0;
      const take = typeof input.take === "number" && input.take >= 0 ? input.take : undefined;
      const sliced = take === undefined ? result.slice(skip) : result.slice(skip, skip + take);
      return sliced;
    },
    async count(input = {}) {
      const where = input.where;
      if (!where) return rows.size;
      let n = 0;
      for (const row of rows.values()) {
        if (matchesWhere(row, where)) n++;
      }
      return n;
    },
    async update({ where, data }) {
      const existing = findFirst(where);
      if (!existing) {
        const err = new Error("Record to update not found.") as Error & { code: string };
        err.code = "P2025";
        throw err;
      }
      // Bump updatedAt the way Prisma does via `@updatedAt`, but let
      // the caller override if they explicitly pass it.
      const next = { ...existing, updatedAt: new Date(), ...data } as T;
      rows.set(next.id, next);
      return next;
    },
    async delete({ where }) {
      const existing = findFirst(where);
      if (!existing) {
        const err = new Error("Record to delete not found.") as Error & { code: string };
        err.code = "P2025";
        throw err;
      }
      rows.delete(existing.id);
      return existing;
    },
    __reset() {
      rows.clear();
    },
  };
}

export interface FakePrismaService {
  example: TableMock<Row>;
  userProfile: TableMock<Row>;
  runWithRlsTenant<T>(fn: (tx: FakePrismaService) => Promise<T>, tenantId?: string): Promise<T>;
  /** Test-only: clear every table. */
  __resetAll(): void;
  /** Index access for project-owned tables (Proxy-backed). */
  [key: string]: unknown;
}

/**
 * Reserved property names the Proxy must NOT route to a `TableMock`.
 * These are the methods / hooks the fake itself exposes — accessing
 * `fake.runWithRlsTenant` should hit the real function, not a
 * dynamically-created table mock.
 */
const RESERVED_KEYS = new Set<string | symbol>([
  "runWithRlsTenant",
  "__resetAll",
  // Internal slot used by the Proxy to enumerate dynamic tables
  // when wiping state via `__resetAll`.
  "__tables__",
  // Symbols / inspection-time hooks Node, Vitest, and `expect()` use
  // to introspect the object. Routing these to a table mock confuses
  // assertion libraries.
  "then",
  "catch",
  "finally",
  Symbol.toPrimitive,
  Symbol.iterator,
  Symbol.asyncIterator,
]);

export function createFakePrisma(): FakePrismaService {
  // Backing store: every accessed table name maps to a single TableMock
  // instance. Stable identity is important — service code that holds
  // a reference between calls must see the same map.
  const tables = new Map<string, TableMock<Row>>();

  const ensureTable = (name: string): TableMock<Row> => {
    let table = tables.get(name);
    if (!table) {
      table = makeTable();
      tables.set(name, table);
    }
    return table;
  };

  // Pre-seed the two template-shipped tables so existing story tests
  // get the same instance on every access (no surprise re-creation
  // when a third party also accesses them).
  ensureTable("example");
  ensureTable("userProfile");

  const base: Pick<FakePrismaService, "runWithRlsTenant" | "__resetAll"> & {
    __tables__: Map<string, TableMock<Row>>;
  } = {
    async runWithRlsTenant(fn) {
      // RLS enforcement is mimicked by the service code (which always
      // passes `tenantId` in the `where` clause). The fake just calls
      // the callback with itself as the tx — same surface as the real
      // Prisma transaction client.
      return fn(proxy);
    },
    __resetAll() {
      for (const table of tables.values()) table.__reset();
    },
    __tables__: tables,
  };

  const proxy = new Proxy(base, {
    get(target, prop) {
      if (RESERVED_KEYS.has(prop)) {
        return Reflect.get(target, prop);
      }
      if (typeof prop !== "string") {
        return Reflect.get(target, prop);
      }
      return ensureTable(prop);
    },
    has(target, prop) {
      if (RESERVED_KEYS.has(prop)) return Reflect.has(target, prop);
      if (typeof prop !== "string") return Reflect.has(target, prop);
      // Always true: any property name maps to a (possibly future) table.
      return true;
    },
  }) as unknown as FakePrismaService;

  return proxy;
}

/**
 * Cast a `FakePrismaService` to `PrismaService` for service
 * constructors that expect the real type. The fake covers everything
 * the slim modules call.
 */
export function asPrismaService(fake: FakePrismaService): PrismaService {
  return fake as unknown as PrismaService;
}
