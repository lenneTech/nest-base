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
 */

import type { PrismaService } from "../../src/core/prisma/prisma.service.js";

type Row = Record<string, unknown> & {
  id: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface TableMock<T extends Row> {
  create(input: { data: Partial<T> & Pick<T, "id"> }): Promise<T>;
  findUnique(input: { where: Partial<T> }): Promise<T | null>;
  findMany(input?: {
    where?: Partial<T>;
    orderBy?: { [k: string]: "asc" | "desc" } | Array<{ [k: string]: "asc" | "desc" }>;
  }): Promise<T[]>;
  update(input: { where: Partial<T>; data: Partial<T> }): Promise<T>;
  delete(input: { where: Partial<T> }): Promise<T>;
  /** Test-only: clear all rows. Use in `beforeEach` to reset state. */
  __reset(): void;
}

function makeTable<T extends Row>(): TableMock<T> {
  const rows = new Map<string, T>();

  const matchesWhere = (row: T, where: Partial<T>): boolean => {
    for (const [key, value] of Object.entries(where)) {
      if (row[key as keyof T] !== value) return false;
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
      const row = {
        createdAt: now,
        updatedAt: now,
        ...data,
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
      return result;
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
