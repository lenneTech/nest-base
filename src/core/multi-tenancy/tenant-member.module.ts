import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
} from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";
import { PrismaTenantMemberStorage } from "./prisma-tenant-member-storage.js";
import {
  type AddMemberInput,
  type TenantMemberRecord,
  type TenantMemberStatus,
  type TenantMemberStorage,
  TenantMemberAlreadyExistsError,
  TenantMemberNotFoundError,
  TenantMemberService,
} from "./tenant-member.service.js";

const TENANT_MEMBER_STORAGE = Symbol.for("lt:TenantMemberStorage");

/**
 * In-memory fallback used by tests that exercise `TenantMemberService`
 * without a Postgres testcontainer. Production wiring uses
 * `PrismaTenantMemberStorage` — see the providers block below.
 *
 * Exported so tests can opt into the legacy behaviour without
 * re-defining the storage shape.
 */
export class InMemoryTenantMemberStorage implements TenantMemberStorage {
  private readonly map = new Map<string, TenantMemberRecord>();

  async findByUserAndTenant(userId: string, tenantId: string): Promise<TenantMemberRecord | null> {
    for (const r of this.map.values()) {
      if (r.userId === userId && r.tenantId === tenantId) return r;
    }
    return null;
  }
  async listByTenant(tenantId: string): Promise<TenantMemberRecord[]> {
    return [...this.map.values()].filter((r) => r.tenantId === tenantId);
  }
  async insert(record: TenantMemberRecord): Promise<TenantMemberRecord> {
    this.map.set(record.id, record);
    return record;
  }
  async updateStatus(id: string, status: TenantMemberStatus): Promise<TenantMemberRecord | null> {
    const existing = this.map.get(id);
    if (!existing) return null;
    const updated = { ...existing, status };
    this.map.set(id, updated);
    return updated;
  }
  async remove(id: string): Promise<boolean> {
    return this.map.delete(id);
  }
}

@Controller("tenant-members")
class TenantMemberController {
  constructor(private readonly service: TenantMemberService) {}

  @Get(":tenantId")
  async list(@Param("tenantId") tenantId: string): Promise<TenantMemberRecord[]> {
    return this.service.listByTenant(tenantId);
  }

  @Post()
  async add(@Body() body: AddMemberInput): Promise<TenantMemberRecord> {
    if (!body?.userId || !body?.tenantId || !body?.role) {
      throw new BadRequestException("userId, tenantId, role are required");
    }
    try {
      return await this.service.add(body);
    } catch (err) {
      if (err instanceof TenantMemberAlreadyExistsError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
  }

  @Put(":id/status")
  async updateStatus(
    @Param("id") id: string,
    @Body() body: { status: TenantMemberStatus },
  ): Promise<TenantMemberRecord> {
    try {
      if (body.status === "ACTIVE") return await this.service.activate(id);
      if (body.status === "SUSPENDED") return await this.service.suspend(id);
      throw new BadRequestException(`unsupported status: ${body.status}`);
    } catch (err) {
      if (err instanceof TenantMemberNotFoundError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
  }

  @Delete(":id")
  async remove(@Param("id") id: string): Promise<{ removed: true }> {
    try {
      await this.service.remove(id);
      return { removed: true };
    } catch (err) {
      if (err instanceof TenantMemberNotFoundError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
  }
}

/**
 * TenantMemberModule — `/tenant-members` CRUD over a Postgres-backed
 * `TenantMemberStorage`. The `PrismaTenantMemberStorage` adapter
 * writes through to the `tenant_members` table declared in
 * `prisma/schema.prisma`; the previous in-memory storage is exported
 * for tests that don't need a live DB but stays out of the production
 * graph.
 */
@Module({
  controllers: [TenantMemberController],
  providers: [
    {
      provide: TENANT_MEMBER_STORAGE,
      useFactory: (prisma: PrismaService) => new PrismaTenantMemberStorage(prisma),
      inject: [PrismaService],
    },
    {
      provide: TenantMemberService,
      useFactory: (storage: TenantMemberStorage) => new TenantMemberService(storage),
      inject: [TENANT_MEMBER_STORAGE],
    },
  ],
  exports: [TenantMemberService, TENANT_MEMBER_STORAGE],
})
export class TenantMemberModule {}
