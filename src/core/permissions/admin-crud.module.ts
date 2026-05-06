import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Optional,
  Param,
  Patch,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";

import { buildDevPortalShellInput, renderDevPortalShell } from "../dx/dev-portal-shell.js";

import { PrismaService } from "../prisma/prisma.service.js";
import { buildPermissionMatrix } from "./admin-permissions-planner.js";
import {
  buildPermissionReport,
  type PermissionReport,
  type PermissionRule,
} from "./permission-report.js";
import { PermissionService } from "./permission.service.js";

/**
 * AdminCrudModule — Prisma-backed CRUD for `/admin/{roles, policies,
 * permissions}` plus `POST /admin/permissions/test` (CF.MTPERM /
 * iter-115). The previous in-memory implementation lost rows on
 * restart and made the `/admin/permissions/test.json` endpoint
 * always-empty (Issue #51 — admin-spa fake). Iter-115 routes every
 * call through the existing `prisma.role`, `prisma.policy`,
 * `prisma.permission`, `prisma.rolePolicy` Prisma models.
 *
 * Mutation invalidates the per-(userId, tenantId) ability cache via
 * `PermissionService.invalidateAll()` so a freshly-edited rule is
 * visible on the next request without waiting for the 60s TTL.
 */

interface RoleCreateBody {
  name?: unknown;
  description?: unknown;
  isSystem?: unknown;
  isPublic?: unknown;
  parentId?: unknown;
  tenantId?: unknown;
}

interface PolicyCreateBody {
  name?: unknown;
  description?: unknown;
}

interface PermissionCreateBody {
  policyId?: unknown;
  resource?: unknown;
  action?: unknown;
  itemFilter?: unknown;
  fields?: unknown;
}

interface RolePolicyAttachBody {
  roleId?: unknown;
  policyId?: unknown;
}

interface RolePatchBody {
  name?: unknown;
  description?: unknown;
  parentId?: unknown;
}

const ALLOWED_ACTIONS = ["CREATE", "READ", "UPDATE", "DELETE", "SHARE"] as const;
type AllowedAction = (typeof ALLOWED_ACTIONS)[number];

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BadRequestException(`${label} must be a non-empty string`);
  }
  return value;
}

function asOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  return value;
}

function asAction(value: unknown): AllowedAction {
  const upper = typeof value === "string" ? value.toUpperCase() : "";
  if ((ALLOWED_ACTIONS as readonly string[]).includes(upper)) {
    return upper as AllowedAction;
  }
  throw new BadRequestException(
    `action must be one of: ${ALLOWED_ACTIONS.join(", ")} (received: ${String(value)})`,
  );
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function wantsHtml(accept: string | undefined): boolean {
  if (!accept) return false;
  return accept.includes("text/html");
}

async function negotiate<T>(
  accept: string | undefined,
  res: Response,
  title: string,
  jsonFactory: () => Promise<T> | T,
): Promise<T | undefined> {
  if (wantsHtml(accept)) {
    // Browser navigation: ship the SPA shell so react-router can
    // render the matching page client-side. The same JSON payload
    // remains accessible to fetch() callers (Accept: */* default)
    // because they don't request text/html.
    res
      .setHeader("content-type", "text/html; charset=utf-8")
      .send(renderDevPortalShell(buildDevPortalShellInput({ title, brand: "central" })));
    return undefined;
  }
  const json = await jsonFactory();
  res.json(json);
  return undefined;
}

@Injectable()
class RoleAdminService {
  constructor(private readonly prisma: PrismaService) {}

  // Iter-202 reviewer-G3 closure: every read/write is now scoped to
  // the operator's `x-tenant-id` header. Roles carry `tenantId` and
  // RLS is enabled on `roles`, but relying solely on RLS leaves the
  // door open if the connection's `app.tenant_id` setting drifts —
  // the explicit Prisma predicate is defense-in-depth alongside the
  // policy. Mirrors iter-201's `auditBrowserJson` pattern.
  list(tenantId: string) {
    return this.prisma.role.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
  }
  get(id: string, tenantId: string) {
    return this.prisma.role.findFirst({ where: { id, tenantId } });
  }
  async create(body: RoleCreateBody, tenantId: string) {
    const name = asString(body.name, "name");
    // If the body carries a tenantId, it MUST match the header — never
    // trust the body to escape the operator's scope.
    if (
      typeof body.tenantId === "string" &&
      body.tenantId.length > 0 &&
      body.tenantId !== tenantId
    ) {
      throw new BadRequestException("body.tenantId must match the x-tenant-id header");
    }
    return this.prisma.role.create({
      data: {
        name,
        tenantId,
        description: asOptionalString(body.description),
        isSystem: typeof body.isSystem === "boolean" ? body.isSystem : false,
        isPublic: typeof body.isPublic === "boolean" ? body.isPublic : false,
        parentId: typeof body.parentId === "string" ? body.parentId : null,
      },
    });
  }
  async delete(id: string, tenantId: string) {
    const result = await this.prisma.role.deleteMany({ where: { id, tenantId } });
    if (result.count === 0) {
      // Use a sentinel error shape Prisma's `.delete()` would have
      // raised on a missing row — the controller catches this and
      // surfaces a 404, matching the prior contract.
      throw new NotFoundException(`role not found: ${id}`);
    }
  }
  async update(id: string, tenantId: string, body: RolePatchBody) {
    // Scope to the operator's tenant — same defense-in-depth as create().
    const existing = await this.prisma.role.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException(`role not found: ${id}`);
    return this.prisma.role.update({
      where: { id },
      data: {
        ...(typeof body.name === "string" && body.name.length > 0 ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: asOptionalString(body.description) } : {}),
        // Allow clearing parentId by passing null explicitly.
        ...(body.parentId !== undefined
          ? { parentId: typeof body.parentId === "string" && body.parentId.length > 0 ? body.parentId : null }
          : {}),
      },
    });
  }
  listPolicies(id: string, tenantId: string) {
    // Return the policies (with their permissions) attached to a role.
    return this.prisma.rolePolicy.findMany({
      where: { role: { id, tenantId } },
      include: { policy: { include: { permissions: true } } },
    });
  }
}

@Injectable()
class PolicyAdminService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.policy.findMany({
      orderBy: { createdAt: "asc" },
      include: { permissions: true },
    });
  }
  get(id: string) {
    return this.prisma.policy.findUnique({
      where: { id },
      include: { permissions: true },
    });
  }
  async create(body: PolicyCreateBody) {
    const name = asString(body.name, "name");
    return this.prisma.policy.create({
      data: { name, description: asOptionalString(body.description) },
    });
  }
  async delete(id: string) {
    return this.prisma.policy.delete({ where: { id } });
  }
  listRoles(id: string) {
    // Return the roles that have this policy attached — used by the
    // "Verwendung" column on PoliciesAdminPage to show which roles
    // consume a given policy.
    return this.prisma.rolePolicy.findMany({
      where: { policyId: id },
      include: { role: true },
    });
  }
}

@Injectable()
class PermissionAdminService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.permission.findMany({ orderBy: { createdAt: "asc" } });
  }
  get(id: string) {
    return this.prisma.permission.findUnique({ where: { id } });
  }
  async create(body: PermissionCreateBody) {
    const policyId = asString(body.policyId, "policyId");
    const resource = asString(body.resource, "resource");
    const action = asAction(body.action);
    const fields = asStringArray(body.fields);
    return this.prisma.permission.create({
      data: {
        policyId,
        resource,
        action,
        fields,
        itemFilter:
          body.itemFilter && typeof body.itemFilter === "object"
            ? (body.itemFilter as object)
            : undefined,
      },
    });
  }
  async delete(id: string) {
    return this.prisma.permission.delete({ where: { id } });
  }
  async attachToRole(body: RolePolicyAttachBody, tenantId: string) {
    const roleId = asString(body.roleId, "roleId");
    const policyId = asString(body.policyId, "policyId");
    // Iter-202 reviewer-flagged extension: the attach route was the
    // mirror class of the G3 RoleAdminService gap — without a tenant
    // precheck on `roleId`, an operator with a global Policy id +
    // ANY tenant's Role uuid could attach the policy to the foreign
    // role. Probing here pins the role to the operator's tenant.
    const role = await this.prisma.role.findFirst({ where: { id: roleId, tenantId } });
    if (!role) {
      throw new NotFoundException(`role not found: ${roleId}`);
    }
    return this.prisma.rolePolicy.create({ data: { roleId, policyId } });
  }
  async detachFromRole(roleId: string, policyId: string, tenantId: string) {
    // Same scope guard as attach: only allow detaching links whose
    // role belongs to the operator's tenant.
    const role = await this.prisma.role.findFirst({ where: { id: roleId, tenantId } });
    if (!role) {
      throw new NotFoundException(`role not found: ${roleId}`);
    }
    return this.prisma.rolePolicy.delete({ where: { roleId_policyId: { roleId, policyId } } });
  }
  async buildMatrix(tenantId: string) {
    // Resolve roles scoped to the tenant, then join through RolePolicy
    // → Policy → Permission to produce the full matrix input.
    const roles = await this.prisma.role.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
    });
    const rolePolicies = await this.prisma.rolePolicy.findMany({
      where: { role: { tenantId } },
      include: { policy: { include: { permissions: true } } },
    });

    // Flatten the join into a MatrixInput.permissions list where each
    // permission row gets the roleId that owns the policy carrying it.
    const permissions = rolePolicies.flatMap((rp) =>
      rp.policy.permissions.map((perm) => ({
        id: perm.id,
        policyId: perm.policyId,
        resource: perm.resource,
        action: String(perm.action),
        roleId: rp.roleId,
      })),
    );
    return buildPermissionMatrix({
      permissions,
      roles: roles.map((r) => ({ id: r.id, name: r.name })),
    });
  }
}

// Iter-202 reviewer feedback: bare non-empty check let `not-a-uuid`
// strings through to Prisma where they triggered an opaque cast error
// instead of a clean 400. The canonical contract documented at
// `tenant-guard.ts:6-7` is "present and parseable as a UUID"; mirror
// that at every controller header-read entry-point.
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function requireTenantHeader(tenantHeader: string | undefined): string {
  const tenantId = tenantHeader?.trim() ?? "";
  if (tenantId.length === 0) {
    throw new BadRequestException("x-tenant-id header is required");
  }
  if (!UUID_PATTERN.test(tenantId)) {
    throw new BadRequestException("x-tenant-id header must be a valid UUID");
  }
  return tenantId;
}

@Controller("admin/roles")
class RoleAdminController {
  constructor(
    private readonly service: RoleAdminService,
    @Optional() @Inject(PermissionService) private readonly permissions?: PermissionService,
  ) {}

  @Get()
  async list(
    @Headers("x-tenant-id") tenantHeader: string | undefined,
    @Headers("accept") accept: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const tenantId = requireTenantHeader(tenantHeader);
    await negotiate(accept, res, "Roles", () => this.service.list(tenantId));
  }
  @Post()
  async create(
    @Headers("x-tenant-id") tenantHeader: string | undefined,
    @Body() body: RoleCreateBody,
  ) {
    const tenantId = requireTenantHeader(tenantHeader);
    const created = await this.service.create(body, tenantId);
    this.permissions?.invalidateAll();
    return created;
  }
  @Get(":id")
  async get(@Headers("x-tenant-id") tenantHeader: string | undefined, @Param("id") id: string) {
    const tenantId = requireTenantHeader(tenantHeader);
    const record = await this.service.get(id, tenantId);
    if (!record) throw new NotFoundException(`role not found: ${id}`);
    return record;
  }
  @Delete(":id")
  async remove(@Headers("x-tenant-id") tenantHeader: string | undefined, @Param("id") id: string) {
    const tenantId = requireTenantHeader(tenantHeader);
    try {
      await this.service.delete(id, tenantId);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new NotFoundException(`role not found: ${id}`);
    }
    this.permissions?.invalidateAll();
    return { removed: true };
  }
  @Patch(":id")
  async update(
    @Headers("x-tenant-id") tenantHeader: string | undefined,
    @Param("id") id: string,
    @Body() body: RolePatchBody,
  ) {
    const tenantId = requireTenantHeader(tenantHeader);
    const updated = await this.service.update(id, tenantId, body);
    this.permissions?.invalidateAll();
    return updated;
  }
  @Get(":id/policies")
  async listPolicies(
    @Headers("x-tenant-id") tenantHeader: string | undefined,
    @Param("id") id: string,
  ) {
    const tenantId = requireTenantHeader(tenantHeader);
    // Verify the role belongs to the operator's tenant before exposing data.
    const role = await this.service.get(id, tenantId);
    if (!role) throw new NotFoundException(`role not found: ${id}`);
    return this.service.listPolicies(id, tenantId);
  }
}

@Controller("admin/policies")
class PolicyAdminController {
  constructor(
    private readonly service: PolicyAdminService,
    @Optional() @Inject(PermissionService) private readonly permissions?: PermissionService,
  ) {}

  @Get()
  async list(@Headers("accept") accept: string | undefined, @Res() res: Response): Promise<void> {
    await negotiate(accept, res, "Policies", () => this.service.list());
  }
  @Post()
  async create(@Body() body: PolicyCreateBody) {
    const created = await this.service.create(body);
    this.permissions?.invalidateAll();
    return created;
  }
  @Get(":id")
  async get(@Param("id") id: string) {
    const record = await this.service.get(id);
    if (!record) throw new NotFoundException(`policy not found: ${id}`);
    return record;
  }
  @Delete(":id")
  async remove(@Param("id") id: string) {
    try {
      await this.service.delete(id);
    } catch {
      throw new NotFoundException(`policy not found: ${id}`);
    }
    this.permissions?.invalidateAll();
    return { removed: true };
  }
  @Get(":id/roles")
  async listRoles(@Param("id") id: string) {
    const policy = await this.service.get(id);
    if (!policy) throw new NotFoundException(`policy not found: ${id}`);
    return this.service.listRoles(id);
  }
}

@Controller("admin/permissions")
class PermissionAdminController {
  constructor(
    private readonly service: PermissionAdminService,
    @Optional() @Inject(PermissionService) private readonly permissions?: PermissionService,
  ) {}

  @Get()
  async list(@Headers("accept") accept: string | undefined, @Res() res: Response): Promise<void> {
    await negotiate(accept, res, "Permissions", () => this.service.list());
  }
  @Post()
  async create(@Body() body: PermissionCreateBody) {
    const created = await this.service.create(body);
    this.permissions?.invalidateAll();
    return created;
  }
  @Get(":id")
  async get(@Param("id") id: string) {
    const record = await this.service.get(id);
    if (!record) throw new NotFoundException(`permission not found: ${id}`);
    return record;
  }
  @Delete(":id")
  async remove(@Param("id") id: string) {
    try {
      await this.service.delete(id);
    } catch {
      throw new NotFoundException(`permission not found: ${id}`);
    }
    this.permissions?.invalidateAll();
    return { removed: true };
  }

  @Get("matrix.json")
  async matrix(@Headers("x-tenant-id") tenantHeader: string | undefined) {
    const tenantId = requireTenantHeader(tenantHeader);
    return this.service.buildMatrix(tenantId);
  }

  @Post("attach")
  async attach(
    @Headers("x-tenant-id") tenantHeader: string | undefined,
    @Body() body: RolePolicyAttachBody,
  ) {
    const tenantId = requireTenantHeader(tenantHeader);
    const link = await this.service.attachToRole(body, tenantId);
    this.permissions?.invalidateAll();
    return link;
  }

  @Delete("attach/:roleId/:policyId")
  async detach(
    @Headers("x-tenant-id") tenantHeader: string | undefined,
    @Param("roleId") roleId: string,
    @Param("policyId") policyId: string,
  ) {
    const tenantId = requireTenantHeader(tenantHeader);
    try {
      await this.service.detachFromRole(roleId, policyId, tenantId);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new NotFoundException(`attach link not found: ${roleId}/${policyId}`);
    }
    this.permissions?.invalidateAll();
    return { removed: true };
  }

  /**
   * `POST /admin/permissions/test` — given (userId, tenantId, action,
   * subject), resolve the user's full rule set via the configured
   * PermissionStorage adapter and return the matching rules. When
   * `PermissionService` is available the result also includes the
   * effective ability evaluation (allow/deny) so admins can see
   * exactly which rule was responsible.
   */
  @Post("test")
  async test(
    @Headers("x-tenant-id") tenantHeader: string | undefined,
    @Body()
    body: { userId?: unknown; tenantId?: unknown; action?: unknown; subject?: unknown },
  ): Promise<{
    request: { userId: string; tenantId: string; action: string; subject: string };
    report: PermissionReport;
    can: boolean;
  }> {
    // Iter-202 reviewer-flagged: previously the handler resolved an
    // ability for any `body.tenantId` an operator supplied — they
    // could probe permissions for tenants outside their scope. Now
    // the operator's tenant comes from the header, and the body's
    // tenantId must match it (same contract as `RoleAdminService.create`).
    const tenantId = requireTenantHeader(tenantHeader);
    const userId = asString(body?.userId, "userId");
    if (
      typeof body?.tenantId === "string" &&
      body.tenantId.length > 0 &&
      body.tenantId !== tenantId
    ) {
      throw new BadRequestException("body.tenantId must match the x-tenant-id header");
    }
    const action = asString(body?.action, "action");
    const subject = asString(body?.subject, "subject");
    const ability = this.permissions ? await this.permissions.abilityFor(userId, tenantId) : null;
    const can = ability ? ability.can(action, subject) : false;
    const rules: PermissionRule[] = ability
      ? ability.rulesFor(action, subject).map((r) => ({
          action: Array.isArray(r.action) ? r.action.join(",") : String(r.action),
          subject: Array.isArray(r.subject) ? r.subject.join(",") : String(r.subject),
        }))
      : [];
    const report = buildPermissionReport({ userId, tenantId, rules });
    return { request: { userId, tenantId, action, subject }, report, can };
  }
}

@Module({
  controllers: [RoleAdminController, PolicyAdminController, PermissionAdminController],
  providers: [RoleAdminService, PolicyAdminService, PermissionAdminService],
})
export class AdminCrudModule {}
