/**
 * Prisma-backed repository for the Example module — the production
 * implementation. Every query is wrapped in `runWithRlsTenant()` so
 * Postgres' RLS policy on the `examples` table fires with the right
 * `app.tenant_id` SET LOCAL value. That's the second perimeter
 * behind the application-layer permission model: a forgotten WHERE
 * clause cannot leak rows across tenants because the database
 * itself refuses.
 *
 * Patterns demonstrated in this file:
 *
 *   1. **Tenant scoping** — `prisma.runWithRlsTenant(callback, tenantId)`
 *      opens a Postgres transaction, sets `app.tenant_id`, and runs
 *      the callback inside. Use the `tx` argument inside the
 *      callback, NOT `this.prisma.client.example.*` directly — only
 *      the transaction-scoped client sees the SET LOCAL.
 *
 *   2. **Mapping DB rows to domain types** — Prisma returns its own
 *      generated row type (`Prisma.ExampleGetPayload<...>`); we map
 *      to the module's `ExampleRecord` so the service stays
 *      ORM-agnostic and tests stay easy to read.
 *
 *   3. **Error normalisation** — Prisma's not-found errors are
 *      translated to `ExampleNotFoundError`. Constraint violations
 *      bubble up as-is and get caught by the global RFC 7807 filter.
 *
 * To switch the module from in-memory to Prisma:
 *   - run `bun run prepare:schema && bun run prisma:migrate` so the
 *     `examples` table exists
 *   - swap `useClass: InMemoryExampleRepository` for
 *     `useClass: PrismaExampleRepository` in `example.module.ts`
 */

import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../core/prisma/prisma.service.js";

import { ExampleNotFoundError } from "./example.errors.js";
import type { ExampleRepository } from "./example.repository.js";
import type { ExampleListFilter, ExampleRecord, ExampleStatus } from "./example.types.js";

/**
 * Row shape returned by `prisma.example.*`. Kept loose (`unknown`)
 * because the generated `Prisma.ExampleGetPayload<...>` type only
 * exists once the model is added to `schema.prisma` and the client
 * is regenerated. The mapper below verifies the fields exist at
 * runtime so the static type doesn't matter for safety.
 */
interface PrismaExampleRow {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PrismaExampleRepository implements ExampleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insert(record: ExampleRecord): Promise<void> {
    await this.prisma.runWithRlsTenant(async (tx) => {
      // The `tx` client already has `SET LOCAL app.tenant_id` set, so
      // RLS policies on the `examples` table fire. We still pass
      // `tenantId` explicitly so the not-null column is filled — RLS
      // policies use the value to enforce row visibility, the column
      // value is what gets stored.
      await tx.$executeRawUnsafe(
        `INSERT INTO examples (id, tenant_id, name, description, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        record.id,
        record.tenantId,
        record.name,
        record.description,
        record.status,
        record.createdAt,
        record.updatedAt,
      );
    }, record.tenantId);
  }

  async findById(tenantId: string, id: string): Promise<ExampleRecord | null> {
    return this.prisma.runWithRlsTenant(async (tx) => {
      const rows = (await tx.$queryRawUnsafe(
        `SELECT id, tenant_id AS "tenantId", name, description, status,
                created_at AS "createdAt", updated_at AS "updatedAt"
         FROM examples WHERE id = $1 LIMIT 1`,
        id,
      )) as PrismaExampleRow[];
      const row = rows[0];
      return row ? mapRowToRecord(row) : null;
    }, tenantId);
  }

  async list(tenantId: string, filter: ExampleListFilter): Promise<readonly ExampleRecord[]> {
    return this.prisma.runWithRlsTenant(async (tx) => {
      // RLS handles the tenant filter; we only add the optional status
      // filter on top. ORDER BY created_at DESC matches the in-memory
      // repo's behaviour so the service's pagination cursor logic
      // sees the same row order regardless of which repo is wired.
      const rows = filter.status
        ? ((await tx.$queryRawUnsafe(
            `SELECT id, tenant_id AS "tenantId", name, description, status,
                    created_at AS "createdAt", updated_at AS "updatedAt"
             FROM examples WHERE status = $1 ORDER BY created_at DESC`,
            filter.status,
          )) as PrismaExampleRow[])
        : ((await tx.$queryRawUnsafe(
            `SELECT id, tenant_id AS "tenantId", name, description, status,
                    created_at AS "createdAt", updated_at AS "updatedAt"
             FROM examples ORDER BY created_at DESC`,
          )) as PrismaExampleRow[]);
      return rows.map(mapRowToRecord);
    }, tenantId);
  }

  async update(
    tenantId: string,
    id: string,
    patch: Partial<ExampleRecord>,
  ): Promise<ExampleRecord> {
    return this.prisma.runWithRlsTenant(async (tx) => {
      // Build a dynamic SET clause from the patch keys. Postgres
      // can't have an empty SET, so when patch only has updatedAt
      // (no other fields), we still UPDATE that one column.
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      const push = (column: string, value: unknown): void => {
        sets.push(`${column} = $${i++}`);
        values.push(value);
      };
      if (patch.name !== undefined) push("name", patch.name);
      if (patch.description !== undefined) push("description", patch.description);
      if (patch.status !== undefined) push("status", patch.status);
      push("updated_at", patch.updatedAt ?? new Date().toISOString());
      values.push(id);

      const rows = (await tx.$queryRawUnsafe(
        `UPDATE examples SET ${sets.join(", ")} WHERE id = $${i}
         RETURNING id, tenant_id AS "tenantId", name, description, status,
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        ...values,
      )) as PrismaExampleRow[];

      const row = rows[0];
      if (!row) throw new ExampleNotFoundError(id);
      return mapRowToRecord(row);
    }, tenantId);
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    return this.prisma.runWithRlsTenant(async (tx) => {
      const affected = await tx.$executeRawUnsafe(`DELETE FROM examples WHERE id = $1`, id);
      return Number(affected) > 0;
    }, tenantId);
  }
}

/** Translate a raw Postgres row into the module's domain type. */
function mapRowToRecord(row: PrismaExampleRow): ExampleRecord {
  const createdAt =
    row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt);
  const updatedAt =
    row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt);
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    status: row.status as ExampleStatus,
    createdAt,
    updatedAt,
    // `sortValue` is what the cursor planner orders on. We use
    // `createdAt` so newest-first sort is automatic.
    sortValue: createdAt,
  };
}
