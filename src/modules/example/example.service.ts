/**
 * Example service — business logic with Prisma integrated directly.
 *
 * No repository abstraction, no DI token, no in-memory variant in
 * production code. The Prisma typed client gives us per-table methods
 * (`tx.example.create(...)`); tests use a fake `PrismaService` from
 * `tests/lib/fake-prisma.ts`.
 *
 * Tenant isolation is enforced by `runWithRlsTenant()` — every query
 * runs inside a transaction that has `app.tenant_id` set, so RLS
 * policies on the `examples` table reject foreign-tenant rows
 * automatically. The service still passes `tenantId` in the
 * `where`-clause as defense in depth.
 */

import { Injectable } from "@nestjs/common";
import type { Example } from "@prisma/client";

import { ResourceNotFoundError } from "../../core/errors/resource-not-found-error.js";
import {
  type CursorPage,
  type CursorRecord,
  buildCursorPage,
} from "../../core/pagination/cursor.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";

import type {
  CreateExampleDto,
  ExampleResponse,
  ExampleStatus,
  ListExampleQuery,
  UpdateExampleDto,
} from "./example.dto.js";

// ── Errors ──────────────────────────────────────────────────────────

/**
 * Named sentinel for "Example with id X does not exist (or is in
 * another tenant)". Extends `ResourceNotFoundError` so the global
 * `ProblemDetailsExceptionFilter` emits 404 + `CORE_NOT_FOUND`
 * automatically. Before this class extended the framework base,
 * the response was a 500 + `CORE_INTERNAL`.
 */
export class ExampleNotFoundError extends ResourceNotFoundError {
  constructor(id: string) {
    super("Example", id);
    this.name = "ExampleNotFoundError";
  }
}

// ── Service ─────────────────────────────────────────────────────────

@Injectable()
export class ExampleService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateExampleDto): Promise<ExampleResponse> {
    const record = await this.prisma.runWithRlsTenant(
      (tx) =>
        tx.example.create({
          data: {
            id: crypto.randomUUID(),
            tenantId,
            name: dto.name,
            description: dto.description ?? null,
            status: dto.status,
          },
        }),
      tenantId,
    );
    return toResponse(record);
  }

  async list(
    tenantId: string,
    query: ListExampleQuery,
  ): Promise<CursorPage<ExampleResponse & CursorRecord>> {
    // Push pagination to DB: cursor filter + take limit+1 lets Prisma handle
    // the slice instead of loading every tenant row and slicing in-memory.
    //
    // The cursor is the raw record id of the last item on the previous page.
    // We resolve its createdAt first so the main query can use a stable
    // createdAt < cursorDate range filter — this avoids loading all rows
    // and works correctly regardless of ID format (UUID v4 or v7).
    let cursorDate: Date | undefined;
    if (query.cursor) {
      const cursorRecord = await this.prisma.runWithRlsTenant(
        (tx) => tx.example.findUnique({ where: { id: query.cursor! } }),
        tenantId,
      );
      cursorDate = cursorRecord?.createdAt ?? undefined;
    }

    const records = await this.prisma.runWithRlsTenant(
      (tx) =>
        tx.example.findMany({
          where: {
            tenantId,
            ...(query.status ? { status: query.status } : {}),
            ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: query.limit + 1,
        }),
      tenantId,
    );
    return buildCursorPage(
      records.map((r) => ({ ...toResponse(r), id: r.id, sortValue: r.createdAt.toISOString() })),
      query.limit,
    );
  }

  async findById(tenantId: string, id: string): Promise<ExampleResponse> {
    const record = await this.prisma.runWithRlsTenant(
      (tx) => tx.example.findUnique({ where: { id } }),
      tenantId,
    );
    if (!record || record.tenantId !== tenantId) throw new ExampleNotFoundError(id);
    return toResponse(record);
  }

  async update(tenantId: string, id: string, dto: UpdateExampleDto): Promise<ExampleResponse> {
    // Verify the record exists in this tenant before issuing the
    // UPDATE. RLS would also block a foreign-tenant write, but the
    // explicit check produces a clean ExampleNotFoundError instead
    // of a generic Prisma error.
    await this.findById(tenantId, id);
    const record = await this.prisma.runWithRlsTenant(
      (tx) =>
        tx.example.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.description !== undefined ? { description: dto.description } : {}),
            ...(dto.status !== undefined ? { status: dto.status } : {}),
          },
        }),
      tenantId,
    );
    return toResponse(record);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.findById(tenantId, id);
    await this.prisma.runWithRlsTenant((tx) => tx.example.delete({ where: { id } }), tenantId);
  }
}

// ── Mapping helpers ─────────────────────────────────────────────────

function toResponse(record: Example): ExampleResponse {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    status: record.status as ExampleStatus,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
