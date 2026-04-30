/**
 * Example service — business logic only.
 *
 * The service does NOT know how the repository is implemented (Prisma
 * vs in-memory). It only depends on the `ExampleRepository`
 * interface, injected via the `EXAMPLE_REPOSITORY` token. The module
 * picks the binding at startup.
 *
 * What the service owns:
 *   - mapping DTOs to / from the persisted record shape
 *   - timestamp + id generation (via `crypto.randomUUID()`)
 *   - sorting + cursor pagination (using the core `buildCursorPage`
 *     helper)
 *   - throwing the right named error when something goes wrong
 *
 * What the service does NOT own (kept in their own files):
 *   - the persisted record type → `example.types.ts`
 *   - the repository contract → `example.repository.ts`
 *   - the response shape → `example.dto.ts`
 *   - the record→response mapper → `example.mapper.ts`
 *   - named errors → `example.errors.ts`
 *   - DI tokens → `example.tokens.ts`
 *
 * That separation keeps every file under ~50 lines and makes it
 * easy to find what you need.
 */

import { Inject, Injectable } from "@nestjs/common";

import {
  type CursorPage,
  type CursorRecord,
  buildCursorPage,
} from "../../core/pagination/cursor.js";

import type {
  CreateExampleDto,
  ExampleResponse,
  ListExampleQuery,
  UpdateExampleDto,
} from "./example.dto.js";
import { ExampleNotFoundError } from "./example.errors.js";
import { toExampleResponse, toExampleResponseRecord } from "./example.mapper.js";
import type { ExampleRepository } from "./example.repository.js";
import { EXAMPLE_REPOSITORY } from "./example.tokens.js";
import type { ExampleRecord } from "./example.types.js";

@Injectable()
export class ExampleService {
  constructor(@Inject(EXAMPLE_REPOSITORY) private readonly repository: ExampleRepository) {}

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
    await this.repository.insert(record);
    return toExampleResponse(record);
  }

  async list(
    tenantId: string,
    query: ListExampleQuery,
  ): Promise<CursorPage<ExampleResponse & CursorRecord>> {
    const filter = query.status ? { status: query.status } : {};
    const records = await this.repository.list(tenantId, filter);
    // Newest first; cursor pagination slices the result.
    const sorted = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const startIndex = query.cursor
      ? Math.max(0, sorted.findIndex((r) => r.id === query.cursor) + 1)
      : 0;
    const page = sorted.slice(startIndex, startIndex + query.limit + 1);
    return buildCursorPage(page.map(toExampleResponseRecord), query.limit);
  }

  async findById(tenantId: string, id: string): Promise<ExampleResponse> {
    const record = await this.repository.findById(tenantId, id);
    if (!record) throw new ExampleNotFoundError(id);
    return toExampleResponse(record);
  }

  async update(tenantId: string, id: string, dto: UpdateExampleDto): Promise<ExampleResponse> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new ExampleNotFoundError(id);
    const patch: Partial<ExampleRecord> = {
      updatedAt: new Date().toISOString(),
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
    };
    const updated = await this.repository.update(tenantId, id, patch);
    return toExampleResponse(updated);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const ok = await this.repository.delete(tenantId, id);
    if (!ok) throw new ExampleNotFoundError(id);
  }
}
