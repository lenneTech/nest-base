/**
 * Example service — reference for tenant-aware CRUD with explicit
 * cursor pagination and pure planners for the non-trivial bits.
 *
 * Patterns demonstrated:
 *   - Tenant scoping via `runWithRlsTenant()` so every query sees
 *     `SET LOCAL app.tenant_id` and RLS policies enforce isolation
 *     even if a WHERE clause is forgotten.
 *   - Storage abstraction via `ExampleStorage` interface so the
 *     service can be tested without Postgres (the tests pass an
 *     in-memory implementation).
 *   - Cursor pagination via the core `buildCursorPage()` helper.
 *   - Named errors that the global filter maps to RFC 7807 problem
 *     details with the right status code.
 *
 * The PrismaService injection is shown but commented — uncomment it
 * once you've added a real Prisma model. Until then the in-memory
 * storage keeps the example self-contained.
 */

import { Inject, Injectable } from "@nestjs/common";

import {
  type CursorPage,
  buildCursorPage,
  type CursorRecord,
} from "../../core/pagination/cursor.js";
import type {
  CreateExampleDto,
  ExampleResponse,
  ListExampleQuery,
  UpdateExampleDto,
} from "./example.dto.js";

export class ExampleNotFoundError extends Error {
  constructor(id: string) {
    super(`Example not found: ${id}`);
    this.name = "ExampleNotFoundError";
  }
}

export interface ExampleRecord extends CursorRecord {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: "draft" | "published" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface ExampleStorage {
  insert(record: ExampleRecord): Promise<void>;
  findById(tenantId: string, id: string): Promise<ExampleRecord | null>;
  list(
    tenantId: string,
    filter: { status?: "draft" | "published" | "archived" },
  ): Promise<readonly ExampleRecord[]>;
  update(tenantId: string, id: string, patch: Partial<ExampleRecord>): Promise<ExampleRecord>;
  delete(tenantId: string, id: string): Promise<boolean>;
}

export const EXAMPLE_STORAGE = Symbol.for("lt:ExampleStorage");

@Injectable()
export class ExampleService {
  constructor(@Inject(EXAMPLE_STORAGE) private readonly storage: ExampleStorage) {}

  async create(tenantId: string, dto: CreateExampleDto): Promise<ExampleResponse> {
    const now = new Date().toISOString();
    const record: ExampleRecord = {
      id: crypto.randomUUID(),
      sortValue: now,
      tenantId,
      name: dto.name,
      description: dto.description ?? null,
      status: dto.status,
      createdAt: now,
      updatedAt: now,
    };
    await this.storage.insert(record);
    return toResponse(record);
  }

  async list(
    tenantId: string,
    query: ListExampleQuery,
  ): Promise<CursorPage<ExampleResponse & CursorRecord>> {
    const filter = query.status ? { status: query.status } : {};
    const records = await this.storage.list(tenantId, filter);
    // Sort newest first; the planner takes care of slicing into pages.
    const sorted = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const startIdx = query.cursor
      ? Math.max(0, sorted.findIndex((r) => r.id === query.cursor) + 1)
      : 0;
    const slice = sorted.slice(startIdx, startIdx + query.limit + 1);
    return buildCursorPage(slice.map(toResponseRecord), query.limit);
  }

  async findById(tenantId: string, id: string): Promise<ExampleResponse> {
    const record = await this.storage.findById(tenantId, id);
    if (!record) throw new ExampleNotFoundError(id);
    return toResponse(record);
  }

  async update(tenantId: string, id: string, dto: UpdateExampleDto): Promise<ExampleResponse> {
    const existing = await this.storage.findById(tenantId, id);
    if (!existing) throw new ExampleNotFoundError(id);
    const patch: Partial<ExampleRecord> = {
      updatedAt: new Date().toISOString(),
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
    };
    const updated = await this.storage.update(tenantId, id, patch);
    return toResponse(updated);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const ok = await this.storage.delete(tenantId, id);
    if (!ok) throw new ExampleNotFoundError(id);
  }
}

function toResponse(record: ExampleRecord): ExampleResponse {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toResponseRecord(record: ExampleRecord): ExampleResponse & CursorRecord {
  return { ...toResponse(record), id: record.id, sortValue: record.sortValue };
}

/**
 * In-memory storage — default binding for development and tests.
 * Replace with a Prisma-backed implementation in your real module:
 *
 *     @Injectable()
 *     export class PrismaExampleStorage implements ExampleStorage {
 *       constructor(private readonly prisma: PrismaService) {}
 *
 *       insert(record) {
 *         return this.prisma.runWithRlsTenant(record.tenantId, () =>
 *           this.prisma.client.example.create({ data: record }),
 *         );
 *       }
 *       // ... etc
 *     }
 */
@Injectable()
export class InMemoryExampleStorage implements ExampleStorage {
  private readonly records = new Map<string, ExampleRecord>();

  async insert(record: ExampleRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async findById(tenantId: string, id: string): Promise<ExampleRecord | null> {
    const r = this.records.get(id);
    return r && r.tenantId === tenantId ? r : null;
  }

  async list(
    tenantId: string,
    filter: { status?: "draft" | "published" | "archived" },
  ): Promise<readonly ExampleRecord[]> {
    return [...this.records.values()].filter(
      (r) => r.tenantId === tenantId && (filter.status === undefined || r.status === filter.status),
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
    const r = this.records.get(id);
    if (!r || r.tenantId !== tenantId) return false;
    this.records.delete(id);
    return true;
  }
}
