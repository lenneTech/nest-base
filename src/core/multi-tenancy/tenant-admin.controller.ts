/**
 * TenantAdminController — `/admin/tenants/*` (issue #87).
 *
 * Server-side wrappers around Prisma reads + Better-Auth organization
 * write operations. All routes are gated by `@Can("manage", "TenantAdmin")`
 * so only the Administrator CASL role can reach them.
 *
 * Design mirrors user-admin.controller.ts:
 *   - READ operations (list, detail) query Prisma directly.
 *   - WRITE operations (create org, invite, member management) proxy to
 *     the Better-Auth organization admin HTTP API via loopback fetch so BA
 *     lifecycle hooks fire normally.
 *   - Soft-delete/restore toggle TenantSettings.deletedAt directly via
 *     Prisma (no BA involvement — it is a nest-base concept, not a BA one).
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Logger,
  NotFoundException,
  Optional,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";

import { Can } from "../permissions/can.guard.js";
import { Public } from "../permissions/public.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { buildDevPortalShellInput, renderDevPortalShell } from "../dx/dev-portal-shell.js";
import { buildTenantStats, filterTenants } from "./tenant-admin-planner.js";
import { BETTER_AUTH_INSTANCE, type BetterAuthInstance } from "../auth/better-auth.token.js";
import { serverConfigFromEnv } from "../server/server-config.js";

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;

// ── Public types (mirrored by TenantsAdminPage.tsx) ──────────────────

export interface TenantListEntry {
  id: string;
  name: string;
  slug: string | null;
  logo: string | null;
  createdAt: string;
  memberCount: number;
  softDeleted: boolean;
}

export interface MemberEntry {
  id: string;
  userId: string;
  role: string;
  createdAt: string;
  userEmail?: string | null;
}

export interface InvitationEntry {
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: string;
}

export interface TenantSettingsEntry {
  logoUrl: string | null;
  primaryColor: string | null;
  storageLimitMb: number | null;
  contactEmail: string | null;
}

export interface TenantStats {
  memberCount: number;
  userCount: number;
  fileSizeMb: number;
  softDeleted: boolean;
  createdAt: string;
}

export interface TenantDetailResponse extends TenantListEntry {
  members: MemberEntry[];
  invitations: InvitationEntry[];
  settings: TenantSettingsEntry | null;
  stats: TenantStats;
}

// ── Controller ───────────────────────────────────────────────────────

@Controller("admin/tenants")
export class TenantAdminController {
  private readonly logger = new Logger(TenantAdminController.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(BETTER_AUTH_INSTANCE) private readonly auth: BetterAuthInstance | null,
  ) {}

  /**
   * `GET /admin/tenants` — SPA shell for the tenant management page.
   * Follows the same pattern as `/admin/users`: a `@Public()` HTML
   * shell route whose interactive JSON payloads are each gated
   * individually.
   */
  @Public("dev-portal SPA shell — each JSON sidecar below is gated separately")
  @Get()
  @Header("content-type", "text/html; charset=utf-8")
  tenantsAdminPage(): string {
    this.assertDev();
    return renderDevPortalShell(
      buildDevPortalShellInput({ title: "Mandantenverwaltung", brand: "central" }),
    );
  }

  /**
   * `GET /admin/tenants/list.json` — paginated tenant list.
   * Supports `?q=` (substring search), `?limit=`, `?offset=`,
   * `?filter=active|deleted|all`.
   */
  @Can("manage", "TenantAdmin")
  @Get("list.json")
  async tenantsListJson(
    @Query("q") q: string | undefined,
    @Query("limit") limitRaw: string | undefined,
    @Query("offset") offsetRaw: string | undefined,
    @Query("filter") filterRaw: string | undefined,
  ): Promise<{ tenants: TenantListEntry[]; total: number }> {
    this.assertDev();

    const limit = clampLimit(limitRaw);
    const offset = parseOffset(offsetRaw);

    // Fetch all orgs with member counts in a single round-trip.
    const rows = await this.prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { members: true } },
        settings: { select: { deletedAt: true } },
      },
    });

    const orgs = rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug ?? null,
      deletedAt: r.settings?.deletedAt ?? null,
    }));

    const onlyActive = filterRaw === "active";
    const onlyDeleted = filterRaw === "deleted";

    const filtered = filterTenants({
      query: q ?? "",
      orgs,
      limit: limit + offset,
      onlyActive,
      onlyDeleted,
    });
    const sliced = filtered.slice(offset, offset + limit);

    const entries: TenantListEntry[] = sliced.map((ft) => {
      const row = rows.find((r) => r.id === ft.id)!;
      return {
        id: row.id,
        name: row.name,
        slug: row.slug ?? null,
        logo: row.logo ?? null,
        createdAt: row.createdAt.toISOString(),
        memberCount: row._count.members,
        softDeleted: ft.deletedAt !== null,
      };
    });

    return { tenants: entries, total: filtered.length };
  }

  /**
   * `GET /admin/tenants/:id.json` — org detail with members,
   * invitations, settings, and stats snapshot.
   */
  @Can("manage", "TenantAdmin")
  @Get(":id.json")
  async tenantDetailJson(@Param("id") id: string): Promise<TenantDetailResponse> {
    this.assertDev();

    const row = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        members: {
          orderBy: { createdAt: "desc" },
          include: { user: { select: { email: true } } },
        },
        invitations: { orderBy: { expiresAt: "desc" }, take: 50 },
        _count: { select: { members: true } },
        settings: true,
      },
    });

    if (!row) throw new NotFoundException("tenant not found");

    // Sum file sizes for the tenant — file_blobs uses the org id as tenantId.
    const fileSizeAgg = await this.prisma.fileBlob
      .aggregate({
        where: { tenantId: id },
        _sum: { sizeBytes: true },
      })
      .catch(() => ({ _sum: { sizeBytes: 0 } }));

    const stats = buildTenantStats({
      organizationId: id,
      members: row.members,
      fileSizeBytes: fileSizeAgg._sum.sizeBytes ?? 0,
      deletedAt: row.settings?.deletedAt ?? null,
      createdAt: row.createdAt,
    });

    const members: MemberEntry[] = row.members.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
      userEmail: m.user.email ?? null,
    }));

    const invitations: InvitationEntry[] = row.invitations.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role ?? null,
      status: i.status,
      expiresAt: i.expiresAt.toISOString(),
    }));

    const settings: TenantSettingsEntry | null = row.settings
      ? {
          logoUrl: row.settings.logoUrl ?? null,
          primaryColor: row.settings.primaryColor ?? null,
          storageLimitMb: row.settings.storageLimitMb ?? null,
          contactEmail: row.settings.contactEmail ?? null,
        }
      : null;

    return {
      id: row.id,
      name: row.name,
      slug: row.slug ?? null,
      logo: row.logo ?? null,
      createdAt: row.createdAt.toISOString(),
      memberCount: row._count.members,
      softDeleted: row.settings?.deletedAt !== null && row.settings?.deletedAt !== undefined,
      members,
      invitations,
      settings,
      stats,
    };
  }

  /**
   * `POST /admin/tenants` — create a new org via BA + upsert settings.
   */
  @Can("manage", "TenantAdmin")
  @Post()
  async createTenant(
    @Body()
    body: {
      name: string;
      slug?: string;
      logoUrl?: string;
      primaryColor?: string;
      storageLimitMb?: number;
      contactEmail?: string;
    },
  ): Promise<{ id: string; name: string }> {
    this.assertDev();

    if (!body.name?.trim()) {
      throw new BadRequestException("name is required");
    }

    // Create the org via BA organization admin API.
    const result = await this.callBaOrgAdmin<{ organization: { id: string; name: string } }>(
      "create-organization",
      {
        name: body.name.trim(),
        ...(body.slug ? { slug: body.slug.trim() } : {}),
      },
    );

    const orgId = result.organization.id;

    // Upsert settings if any were provided.
    if (body.logoUrl || body.primaryColor || body.storageLimitMb || body.contactEmail) {
      await this.prisma.tenantSettings.upsert({
        where: { organizationId: orgId },
        create: {
          organizationId: orgId,
          logoUrl: body.logoUrl ?? null,
          primaryColor: body.primaryColor ?? null,
          storageLimitMb: body.storageLimitMb ?? null,
          contactEmail: body.contactEmail ?? null,
        },
        update: {
          logoUrl: body.logoUrl ?? null,
          primaryColor: body.primaryColor ?? null,
          storageLimitMb: body.storageLimitMb ?? null,
          contactEmail: body.contactEmail ?? null,
        },
      });
    }

    return { id: orgId, name: result.organization.name };
  }

  /**
   * `PATCH /admin/tenants/:id` — update org name/slug + settings.
   */
  @Can("manage", "TenantAdmin")
  @Patch(":id")
  async updateTenant(
    @Param("id") id: string,
    @Body()
    body: {
      name?: string;
      slug?: string;
      logoUrl?: string;
      primaryColor?: string;
      storageLimitMb?: number;
      contactEmail?: string;
    },
  ): Promise<{ id: string }> {
    this.assertDev();

    // Verify org exists before mutating settings.
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException("tenant not found");

    // Update org metadata via BA if name/slug changed.
    if (body.name || body.slug) {
      await this.callBaOrgAdmin("update-organization", {
        organizationId: id,
        ...(body.name ? { name: body.name.trim() } : {}),
        ...(body.slug ? { slug: body.slug.trim() } : {}),
      });
    }

    // Upsert settings.
    await this.prisma.tenantSettings.upsert({
      where: { organizationId: id },
      create: {
        organizationId: id,
        logoUrl: body.logoUrl ?? null,
        primaryColor: body.primaryColor ?? null,
        storageLimitMb: body.storageLimitMb ?? null,
        contactEmail: body.contactEmail ?? null,
      },
      update: {
        ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl } : {}),
        ...(body.primaryColor !== undefined ? { primaryColor: body.primaryColor } : {}),
        ...(body.storageLimitMb !== undefined ? { storageLimitMb: body.storageLimitMb } : {}),
        ...(body.contactEmail !== undefined ? { contactEmail: body.contactEmail } : {}),
      },
    });

    return { id };
  }

  /**
   * `DELETE /admin/tenants/:id/soft-delete` — set TenantSettings.deletedAt.
   */
  @Can("manage", "TenantAdmin")
  @Delete(":id/soft-delete")
  async softDeleteTenant(@Param("id") id: string): Promise<{ softDeleted: true }> {
    this.assertDev();

    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException("tenant not found");

    await this.prisma.tenantSettings.upsert({
      where: { organizationId: id },
      create: { organizationId: id, deletedAt: new Date() },
      update: { deletedAt: new Date() },
    });

    return { softDeleted: true };
  }

  /**
   * `POST /admin/tenants/:id/restore` — clear TenantSettings.deletedAt.
   */
  @Can("manage", "TenantAdmin")
  @Post(":id/restore")
  async restoreTenant(@Param("id") id: string): Promise<{ softDeleted: false }> {
    this.assertDev();

    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException("tenant not found");

    await this.prisma.tenantSettings.upsert({
      where: { organizationId: id },
      create: { organizationId: id, deletedAt: null },
      update: { deletedAt: null },
    });

    return { softDeleted: false };
  }

  /**
   * `POST /admin/tenants/:id/members/invite` — send a BA invitation.
   */
  @Can("manage", "TenantAdmin")
  @Post(":id/members/invite")
  async inviteMember(
    @Param("id") id: string,
    @Body() body: { email: string; role?: string },
  ): Promise<{ invited: true }> {
    this.assertDev();

    if (!body.email?.trim()) {
      throw new BadRequestException("email is required");
    }

    await this.callBaOrgAdmin("invite-member", {
      organizationId: id,
      email: body.email.trim(),
      role: body.role ?? "member",
    });

    return { invited: true };
  }

  /**
   * `DELETE /admin/tenants/:id/members/:memberId` — remove a member.
   */
  @Can("manage", "TenantAdmin")
  @Delete(":id/members/:memberId")
  async removeMember(
    @Param("id") _id: string,
    @Param("memberId") memberId: string,
  ): Promise<{ removed: true }> {
    this.assertDev();

    await this.callBaOrgAdmin("remove-member", { memberId });

    return { removed: true };
  }

  /**
   * `PATCH /admin/tenants/:id/members/:memberId/role` — change member role.
   */
  @Can("manage", "TenantAdmin")
  @Patch(":id/members/:memberId/role")
  async updateMemberRole(
    @Param("id") _id: string,
    @Param("memberId") memberId: string,
    @Body() body: { role: string },
  ): Promise<{ updated: true }> {
    this.assertDev();

    if (!body.role?.trim()) {
      throw new BadRequestException("role is required");
    }

    await this.callBaOrgAdmin("update-member-role", {
      memberId,
      role: body.role.trim(),
    });

    return { updated: true };
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  /**
   * Forward a mutating action to the Better-Auth organization admin
   * HTTP API. Uses the loopback address so BA lifecycle hooks still fire.
   *
   * Falls back to a `BadRequestException` when the BA instance is not
   * wired (BETTER_AUTH_SECRET not set or organization plugin disabled).
   */
  private async callBaOrgAdmin<T = unknown>(
    action: string,
    payload: Record<string, string | number | undefined>,
  ): Promise<T> {
    if (!this.auth) {
      throw new BadRequestException(
        "Better-Auth is not configured; tenant admin mutations are unavailable",
      );
    }

    const cfg = serverConfigFromEnv(process.env);
    const baseUrl = cfg.baseUrl ?? "http://localhost:3000";
    const url = `${baseUrl}/api/auth/organization/${action}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined)),
      ),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // Log the internal BA response server-side only — the raw body may
      // contain stack traces, token fragments, or schema details that must
      // not reach the client.
      this.logger.error(`BA org /${action} failed (${res.status}): ${text}`);
      throw new BadRequestException("organization operation failed");
    }

    return res.json() as Promise<T>;
  }

  private assertDev(): void {
    const cfg = serverConfigFromEnv(process.env);
    if (cfg.env !== "development") {
      throw new NotFoundException();
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function clampLimit(raw: string | undefined): number {
  if (!raw) return DEFAULT_LIST_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIST_LIMIT;
  return Math.min(MAX_LIST_LIMIT, Math.floor(n));
}

function parseOffset(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}
