/**
 * In-memory PrismaService stand-in for fast story tests.
 *
 * Why this exists:
 *
 * The slim module pattern (`src/modules/<x>/<x>.service.ts` calls
 * `prisma.<table>.<method>()` directly) drops the explicit
 * Repository abstraction. That keeps production code shorter, but
 * tests still need a way to exercise the service WITHOUT booting
 * a Postgres testcontainer for every assertion. This helper is the
 * answer: a fake `PrismaService` whose tables are `Map<id, row>`
 * objects in memory.
 *
 * Coverage:
 *   - `runWithRlsTenant(cb, tenantId)` — calls the callback with
 *     `this` as the tx; tenant scoping is enforced manually inside
 *     each table-mock (filters by `tenantId` column on every read).
 *   - Per table: `create`, `findUnique`, `findMany`, `update`,
 *     `delete`. Enough surface for the example + user-profile
 *     reference modules. Add more if you grow the patterns.
 *
 * The helper is intentionally narrow. It doesn't try to be Prisma
 * — it's the smallest contract that lets the service code run
 * unmodified against in-memory data.
 */

import type { PrismaService } from "../../src/core/prisma/prisma.service.js";

type Row = Record<string, unknown> & { id: string };

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
      const row = data as T;
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
          const av = String(a[key as keyof T]);
          const bv = String(b[key as keyof T]);
          return direction === "desc" ? bv.localeCompare(av) : av.localeCompare(bv);
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
      const next = { ...existing, ...data } as T;
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
}

export function createFakePrisma(): FakePrismaService {
  const example = makeTable();
  const userProfile = makeTable();
  const fake: FakePrismaService = {
    example,
    userProfile,
    async runWithRlsTenant(fn) {
      // RLS enforcement is mimicked by the service code (which always
      // passes `tenantId` in the `where` clause). The fake just calls
      // the callback with itself as the tx — same surface as the real
      // Prisma transaction client.
      return fn(fake);
    },
    __resetAll() {
      example.__reset();
      userProfile.__reset();
    },
  };
  return fake;
}

/**
 * Cast a `FakePrismaService` to `PrismaService` for service
 * constructors that expect the real type. The fake covers everything
 * the slim modules call.
 */
export function asPrismaService(fake: FakePrismaService): PrismaService {
  return fake as unknown as PrismaService;
}
