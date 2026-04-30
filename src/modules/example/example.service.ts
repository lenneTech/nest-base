/**
 * Example service — business logic with Prisma integrated directly.
 *
 * No repository abstraction, no DI token, no in-memory variant in
 * production code. The Prisma typed client gives us per-table
 * methods (`prisma.example.create(...)`); tests use a fake
 * PrismaService from `tests/lib/fake-prisma.ts`.
 *
 * Everything the module needs lives in this one file:
 *   - `ExampleStatus` and `ExampleRecord` types
 *   - `ExampleNotFoundError` named sentinel
 *   - record→response mapper
 *   - `ExampleService` business logic with Prisma calls
 *
 * Tenant isolation is enforced by `runWithRlsTenant()` — every
 * query runs inside a transaction that has `app.tenant_id` set, so
 * RLS policies on the `examples` table reject foreign-tenant rows
 * automatically.
 */

import { Injectable } from "@nestjs/common";

import {
  type CursorPage,
  type CursorRecord,
  buildCursorPage,
} from "../../core/pagination/cursor.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";

import type {
  CreateExampleDto,
  ExampleResponse,
  ListExampleQuery,
  UpdateExampleDto,
} from "./example.dto.js";

// ── Types ───────────────────────────────────────────────────────────

export type ExampleStatus = "draft" | "published" | "archived";

export interface ExampleRecord extends CursorRecord {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: ExampleStatus;
  createdAt: string;
  updatedAt: string;
}

// ── Errors ──────────────────────────────────────────────────────────

export class ExampleNotFoundError extends Error {
  constructor(id: string) {
    super(`Example not found: ${id}`);
    this.name = "ExampleNotFoundError";
  }
}

// ── Service ─────────────────────────────────────────────────────────

@Injectable()
export class ExampleService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateExampleDto): Promise<ExampleResponse> {
    const now = new Date().toISOString();
    const record = await this.prisma.runWithRlsTenant(async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (tx as any).example.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          name: dto.name,
          description: dto.description ?? null,
          status: dto.status,
          createdAt: now,
          updatedAt: now,
        },
      }) as Promise<ExampleRecord>;
    }, tenantId);
    return toResponse(record);
  }

  async list(
    tenantId: string,
    query: ListExampleQuery,
  ): Promise<CursorPage<ExampleResponse & CursorRecord>> {
    const records = await this.prisma.runWithRlsTenant(async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (tx as any).example.findMany({
        where: {
          tenantId,
          ...(query.status ? { status: query.status } : {}),
        },
        orderBy: { createdAt: "desc" },
      }) as Promise<ExampleRecord[]>;
    }, tenantId);
    const startIndex = query.cursor
      ? Math.max(0, records.findIndex((r) => r.id === query.cursor) + 1)
      : 0;
    const page = records.slice(startIndex, startIndex + query.limit + 1);
    return buildCursorPage(
      page.map((r) => ({ ...toResponse(r), id: r.id, sortValue: r.createdAt })),
      query.limit,
    );
  }

  async findById(tenantId: string, id: string): Promise<ExampleResponse> {
    const record = await this.prisma.runWithRlsTenant(async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (tx as any).example.findUnique({ where: { id } }) as Promise<ExampleRecord | null>;
    }, tenantId);
    if (!record || record.tenantId !== tenantId) throw new ExampleNotFoundError(id);
    return toResponse(record);
  }

  async update(tenantId: string, id: string, dto: UpdateExampleDto): Promise<ExampleResponse> {
    // Verify the record exists in this tenant before issuing the
    // UPDATE. RLS would also block a foreign-tenant write, but the
    // explicit check produces a clean ExampleNotFoundError instead
    // of a generic Prisma error.
    await this.findById(tenantId, id);
    const record = await this.prisma.runWithRlsTenant(async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (tx as any).example.update({
        where: { id },
        data: {
          updatedAt: new Date().toISOString(),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        },
      }) as Promise<ExampleRecord>;
    }, tenantId);
    return toResponse(record);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    // Same defense-in-depth: verify ownership before delete.
    await this.findById(tenantId, id);
    await this.prisma.runWithRlsTenant(async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).example.delete({ where: { id } });
    }, tenantId);
  }
}

// ── Mapping helpers ─────────────────────────────────────────────────

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
