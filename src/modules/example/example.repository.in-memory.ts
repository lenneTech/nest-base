/**
 * In-memory repository — used in unit / story tests and as the
 * default wiring for `bun run dev` so the server boots green even
 * before the `Example` table has been migrated.
 *
 * Same contract as the Prisma implementation; the service can't tell
 * them apart. Tenant isolation is implemented manually here (filter
 * by `tenantId` on every read/write) — in production that filter
 * comes from RLS automatically, the in-memory class just mimics it.
 */

import { Injectable } from "@nestjs/common";

import { ExampleNotFoundError } from "./example.errors.js";
import type { ExampleRepository } from "./example.repository.js";
import type { ExampleListFilter, ExampleRecord } from "./example.types.js";

@Injectable()
export class InMemoryExampleRepository implements ExampleRepository {
  private readonly records = new Map<string, ExampleRecord>();

  async insert(record: ExampleRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async findById(tenantId: string, id: string): Promise<ExampleRecord | null> {
    const record = this.records.get(id);
    return record && record.tenantId === tenantId ? record : null;
  }

  async list(tenantId: string, filter: ExampleListFilter): Promise<readonly ExampleRecord[]> {
    return [...this.records.values()].filter(
      (record) =>
        record.tenantId === tenantId &&
        (filter.status === undefined || record.status === filter.status),
    );
  }

  async update(
    tenantId: string,
    id: string,
    patch: Partial<ExampleRecord>,
  ): Promise<ExampleRecord> {
    const existing = await this.findById(tenantId, id);
    if (!existing) throw new ExampleNotFoundError(id);
    const next: ExampleRecord = { ...existing, ...patch };
    this.records.set(id, next);
    return next;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record || record.tenantId !== tenantId) return false;
    this.records.delete(id);
    return true;
  }
}
