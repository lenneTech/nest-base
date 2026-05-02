import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Module,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";

import { PrismaService } from "../prisma/prisma.service.js";
import { PrismaTenantSelfServiceStorage } from "./prisma-tenant-self-service-storage.js";
import {
  type CreateTenantInput,
  TenantNameTakenError,
  TenantSelfServiceService,
  type TenantSelfServiceStorage,
  type TenantWithMembership,
} from "./tenant-self-service.service.js";
import { TenantMemberModule } from "./tenant-member.module.js";
import { TenantMemberService } from "./tenant-member.service.js";

interface AuthedRequest extends Request {
  user?: { id: string; tenantId: string | null };
}

interface CreateTenantBody {
  name?: unknown;
}

interface CreateTenantResponse {
  id: string;
  name: string;
  createdAt: string;
  membership: {
    id: string;
    role: string;
    status: string;
    joinedAt?: string;
  };
}

interface MeTenantsResponseRow {
  tenantId: string;
  tenantName: string;
  tenantCreatedAt: string;
  memberId: string;
  role: string;
  status: string;
  invitedAt?: string;
  joinedAt?: string;
}

const TENANT_SELF_SERVICE_STORAGE = Symbol.for("lt:TenantSelfServiceStorage");

/**
 * `GET /me/tenants` — list memberships for the authenticated user.
 *
 * No tenant header required: the route is registered in `tenant-guard.ts`'s
 * `EXEMPT_PREFIXES` (`/me/`). Auth is still required — the
 * `BetterAuthSessionMiddleware` populates `req.user` and 401s anonymous
 * callers. The `req.user` check below is defense-in-depth so the
 * controller never reads `undefined.id`.
 */
@Controller("me/tenants")
export class MeTenantsController {
  constructor(private readonly service: TenantSelfServiceService) {}

  @Get()
  async list(@Req() req: AuthedRequest): Promise<MeTenantsResponseRow[]> {
    if (!req.user) throw new ForbiddenException("authentication required");
    const rows = await this.service.listForUser(req.user.id);
    return rows.map(toMeTenantsRow);
  }
}

/**
 * `POST /tenants` — self-service tenant creation.
 *
 * Authenticated user creates a Tenant + an ACTIVE owner membership in
 * one atomic write. Like `/me/tenants`, the route is exempt from the
 * tenant header check (no header could exist before the tenant did).
 */
@Controller("tenants")
export class TenantSelfServiceController {
  constructor(private readonly service: TenantSelfServiceService) {}

  @Post()
  async create(
    @Req() req: AuthedRequest,
    @Body() body: CreateTenantBody,
  ): Promise<CreateTenantResponse> {
    if (!req.user) throw new ForbiddenException("authentication required");
    const name = typeof body?.name === "string" ? body.name : "";
    const input: CreateTenantInput = { name, ownerId: req.user.id };

    try {
      const result = await this.service.createForUser(input);
      return {
        id: result.tenant.id,
        name: result.tenant.name,
        createdAt: result.tenant.createdAt.toISOString(),
        membership: {
          id: result.member.id,
          role: result.member.role,
          status: result.member.status,
          ...(result.member.joinedAt ? { joinedAt: result.member.joinedAt.toISOString() } : {}),
        },
      };
    } catch (err) {
      if (err instanceof TenantNameTakenError) {
        throw new ConflictException(err.message);
      }
      // The service throws plain Error for empty / blank names. Map to
      // BadRequest so the consumer gets a 400 instead of a 500.
      if (err instanceof Error && /required/.test(err.message)) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }
}

function toMeTenantsRow(row: TenantWithMembership): MeTenantsResponseRow {
  return {
    tenantId: row.tenantId,
    tenantName: row.tenantName,
    tenantCreatedAt: row.tenantCreatedAt.toISOString(),
    memberId: row.memberId,
    role: row.role,
    status: row.status,
    ...(row.invitedAt ? { invitedAt: row.invitedAt.toISOString() } : {}),
    ...(row.joinedAt ? { joinedAt: row.joinedAt.toISOString() } : {}),
  };
}

/**
 * Self-service Tenant module.
 *
 * Wires the planner (`TenantSelfServiceService`), the Prisma adapter,
 * and the two HTTP controllers (`/me/tenants`, `/tenants`). Imported
 * by `AppModule` alongside the existing `TenantMemberModule` — the
 * two modules share the `TenantMemberService` provider via export.
 */
@Module({
  imports: [TenantMemberModule],
  controllers: [MeTenantsController, TenantSelfServiceController],
  providers: [
    {
      provide: TENANT_SELF_SERVICE_STORAGE,
      useFactory: (prisma: PrismaService) => new PrismaTenantSelfServiceStorage(prisma),
      inject: [PrismaService],
    },
    {
      provide: TenantSelfServiceService,
      useFactory: (storage: TenantSelfServiceStorage, members: TenantMemberService) =>
        new TenantSelfServiceService(storage, members),
      inject: [TENANT_SELF_SERVICE_STORAGE, TenantMemberService],
    },
  ],
  exports: [TenantSelfServiceService],
})
export class TenantSelfServiceModule {}
