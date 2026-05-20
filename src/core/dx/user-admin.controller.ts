/**
 * UserAdminController — `/admin/users/*` (issue #86).
 *
 * Server-side wrappers around Prisma reads + Better-Auth admin
 * write operations. JSON / action routes are gated by
 * `@Can("manage", "User")`; the HTML shell is `@Public()` so the React
 * bundle loads. Operators sign in via Better-Auth (session cookie).
 *
 * Design:
 *   - READ operations (list, detail) query Prisma directly for
 *     consistency with the rest of the Dev-Hub's Prisma-backed pages.
 *   - WRITE operations (ban, unban, revoke-sessions) proxy to the
 *     Better-Auth admin HTTP API via an internal fetch. This keeps
 *     BA as the single source-of-truth for `banned` / `banReason` /
 *     `banExpires` columns and honours any BA lifecycle hooks.
 *
 * Why internal fetch rather than `auth.api.admin.*` method calls:
 *   The BA TypeScript client binds the admin API to a JWT-scoped
 *   `client` class, not to a server-side admin utility. Calling the
 *   admin HTTP endpoints via the same process's loopback address is
 *   the BA-recommended server-side approach (mirrors the BA admin
 *   test-suite).
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";

import type { AuthenticatedRequest } from "../auth/session-middleware.js";
import { resolveHubOperatorTenantId } from "../hub/hub-operator-tenant.js";
import { Can } from "../permissions/can.guard.js";
import { PermissionService } from "../permissions/permission.service.js";
import { Public } from "../permissions/public.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { buildDevPortalShellInput, renderDevPortalShell } from "./dev-portal-shell.js";
import { filterUsers, rolesForUser } from "./user-admin-planner.js";
import { BETTER_AUTH_INSTANCE, type BetterAuthInstance } from "../auth/better-auth.token.js";
import { ConfigService } from "../config/config.service.js";
import { uuidV7 } from "../uuid/uuid-v7.js";

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;

export interface UserListEntry {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  banned: boolean;
  createdAt: string;
  updatedAt: string;
  sessionCount: number;
  /** CASL role names from organization memberships (list view). */
  roles: string[];
}

export interface UserMembershipEntry {
  id: string;
  organizationId: string;
  organizationName: string;
  role: string;
  createdAt: string;
}

export interface AssignableRolesResponse {
  organizationId: string;
  organizationName: string;
  roles: Array<{ id: string; name: string }>;
}

export interface SessionEntry {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AccountEntry {
  id: string;
  providerId: string;
  accountId: string;
  createdAt: string;
}

export interface UserDetailResponse extends UserListEntry {
  sessions: SessionEntry[];
  accounts: AccountEntry[];
  memberships: UserMembershipEntry[];
}

@Controller("admin/users")
export class UserAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Optional() @Inject(BETTER_AUTH_INSTANCE) private readonly auth: BetterAuthInstance | null,
    @Optional() private readonly permissions?: PermissionService,
  ) {}

  /**
   * `GET /admin/users` — SPA shell for the user management page.
   * Follows the same pattern as `/admin/sessions`: a `@Public()` HTML
   * shell route whose interactive JSON payloads are each gated
   * individually.
   */
  @Public("dev-portal SPA shell — each JSON sidecar below is gated separately")
  @Get()
  @Header("content-type", "text/html; charset=utf-8")
  usersAdminPage(): string {
    return renderDevPortalShell(
      buildDevPortalShellInput({ title: "User management", brand: "central" }),
    );
  }

  /**
   * `GET /admin/users.json` — paginated user list.
   * Supports `?q=` (substring search), `?limit=`, `?offset=`.
   */
  @Can("manage", "User")
  @Get("list.json")
  async usersListJson(
    @Query("q") q: string | undefined,
    @Query("limit") limitRaw: string | undefined,
    @Query("offset") offsetRaw: string | undefined,
  ): Promise<{ users: UserListEntry[]; total: number }> {
    const limit = clampLimit(limitRaw);
    const offset = parseOffset(offsetRaw);

    // Fetch users with their session counts in one round-trip.
    // Safety cap of 500 rows prevents OOM on large user tables; the
    // planner further slices to the requested limit + offset.
    const rows = await this.prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: MAX_LIST_LIMIT,
      include: { _count: { select: { sessions: true } } },
    });

    const plannerUsers = rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name || null,
      banned: u.banned,
    }));

    const filtered = filterUsers({ query: q ?? "", users: plannerUsers, limit: limit + offset });
    const sliced = filtered.slice(offset, offset + limit);
    const slicedIds = sliced.map((pu) => pu.id);

    const memberRows =
      slicedIds.length === 0
        ? []
        : await this.prisma.member.findMany({
            where: { userId: { in: slicedIds } },
            select: { userId: true, role: true },
          });

    const entries: UserListEntry[] = sliced.map((pu) => {
      const row = rows.find((r) => r.id === pu.id)!;
      return {
        id: row.id,
        email: row.email,
        name: row.name || null,
        emailVerified: row.emailVerified,
        banned: pu.banned,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        sessionCount: row._count.sessions,
        roles: [...rolesForUser(memberRows, row.id)],
      };
    });

    return { users: entries, total: filtered.length };
  }

  /**
   * `GET /admin/users/roles.json` — assignable CASL roles for the
   * operator's organization scope. Works without `x-tenant-id` and when
   * multi-tenancy is disabled (falls back to the operator's membership
   * or the first organization row).
   */
  @Can("manage", "User")
  @Get("roles.json")
  async assignableRolesJson(@Req() req: AuthenticatedRequest): Promise<AssignableRolesResponse> {
    const { organizationId, organizationName } = await this.resolveAssignmentOrganization(req);
    const roleRows = await this.prisma.role.findMany({
      where: { tenantId: organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return {
      organizationId,
      organizationName,
      roles: roleRows,
    };
  }

  /**
   * `GET /admin/users/:id.json` — user detail with sessions +
   * linked OAuth accounts.
   */
  @Can("manage", "User")
  @Get(":id.json")
  async userDetailJson(@Param("id") id: string): Promise<UserDetailResponse> {
    const row = await this.prisma.user.findUnique({
      where: { id },
      include: {
        sessions: { orderBy: { createdAt: "desc" }, take: 50 },
        accounts: { orderBy: { createdAt: "desc" } },
        _count: { select: { sessions: true } },
      },
    });

    if (!row) throw new NotFoundException(`user "${id}" not found`);

    const sessions: SessionEntry[] = row.sessions.map((s) => ({
      id: s.id,
      ipAddress: s.ipAddress ?? null,
      userAgent: s.userAgent ?? null,
      createdAt: s.createdAt.toISOString(),
    }));

    const accounts: AccountEntry[] = row.accounts.map((a) => ({
      id: a.id,
      providerId: a.providerId,
      accountId: a.accountId,
      createdAt: a.createdAt.toISOString(),
    }));

    const memberRows = await this.prisma.member.findMany({
      where: { userId: id },
      orderBy: { createdAt: "asc" },
      include: { organization: { select: { name: true } } },
    });
    const memberships: UserMembershipEntry[] = memberRows.map((m) => ({
      id: m.id,
      organizationId: m.organizationId,
      organizationName: m.organization.name,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
    }));

    return {
      id: row.id,
      email: row.email,
      name: row.name || null,
      emailVerified: row.emailVerified,
      banned: row.banned,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      sessionCount: row._count.sessions,
      roles: [...rolesForUser(memberRows, row.id)],
      memberships,
      sessions,
      accounts,
    };
  }

  /**
   * `PATCH /admin/users/:id/role` — assign or change the user's CASL
   * role in the default organization. Creates a membership row when the
   * user has none (single-tenant deployments without the BA org plugin).
   */
  @Can("manage", "User")
  @Patch(":id/role")
  async assignUserRole(
    @Req() req: AuthenticatedRequest,
    @Param("id") userId: string,
    @Body() body: { role?: string },
  ): Promise<{ updated: true; memberId: string; organizationId: string; role: string }> {
    const role = body.role?.trim() ?? "";
    if (!role) {
      throw new BadRequestException("role is required");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException(`user "${userId}" not found`);
    }

    const { organizationId } = await this.resolveAssignmentOrganization(req);
    const roleRecord = await this.prisma.role.findFirst({
      where: { tenantId: organizationId, name: role },
      select: { id: true },
    });
    if (!roleRecord) {
      throw new BadRequestException(`role "${role}" is not defined for this organization`);
    }

    const existing = await this.prisma.member.findFirst({
      where: { userId, organizationId },
      select: { id: true },
    });

    let memberId: string;
    if (existing) {
      await this.prisma.member.update({
        where: { id: existing.id },
        data: { role },
      });
      memberId = existing.id;
    } else {
      const created = await this.prisma.member.create({
        data: {
          id: uuidV7(),
          userId,
          organizationId,
          role,
          createdAt: new Date(),
        },
      });
      memberId = created.id;
    }

    this.permissions?.invalidate(userId, organizationId);
    return { updated: true, memberId, organizationId, role };
  }

  /**
   * `PATCH /admin/users/:id/members/:memberId/role` — change the user's
   * CASL role for an organization. Available from `/admin/users` even when
   * the multi-tenancy feature flag hides `/admin/tenants`.
   */
  @Can("manage", "User")
  @Patch(":id/members/:memberId/role")
  async updateMemberRole(
    @Param("id") userId: string,
    @Param("memberId") memberId: string,
    @Body() body: { role?: string },
  ): Promise<{ updated: true }> {
    const role = body.role?.trim() ?? "";
    if (!role) {
      throw new BadRequestException("role is required");
    }

    const member = await this.prisma.member.findFirst({
      where: { id: memberId, userId },
      select: { id: true, organizationId: true },
    });
    if (!member) {
      throw new NotFoundException(`membership "${memberId}" not found for user "${userId}"`);
    }

    await this.prisma.member.update({
      where: { id: memberId },
      data: { role },
    });
    this.permissions?.invalidate(userId, member.organizationId);

    return { updated: true };
  }

  /**
   * `POST /admin/users/create` — create a user via Better-Auth admin API.
   */
  @Can("manage", "User")
  @Post("create")
  async createUser(
    @Req() req: Request,
    @Body() body: { email?: string; name?: string; password?: string },
  ): Promise<{ created: true }> {
    const email = body.email?.trim().toLowerCase() ?? "";
    const name = body.name?.trim() ?? "";
    const password = body.password ?? "";
    if (!email || !name || !password) {
      throw new BadRequestException("Email, name, and password are required.");
    }
    await this.callBaAdmin(req, "create-user", {
      email,
      name,
      password,
      role: "user",
    });
    return { created: true };
  }

  /**
   * `POST /admin/users/:id/set-email-verified` — set `emailVerified` directly
   * in Prisma (dev-operator convenience; BA has no admin toggle for this).
   */
  @Can("manage", "User")
  @Post(":id/set-email-verified")
  async setEmailVerified(
    @Param("id") id: string,
    @Body() body: { verified?: boolean },
  ): Promise<{ emailVerified: boolean }> {
    if (typeof body.verified !== "boolean") {
      throw new BadRequestException("verified must be a boolean.");
    }

    const existing = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`user "${id}" not found`);
    }

    const row = await this.prisma.user.update({
      where: { id },
      data: { emailVerified: body.verified },
      select: { emailVerified: true },
    });
    return { emailVerified: row.emailVerified };
  }

  /**
   * `POST /admin/users/:id/update` — update name/email via BA admin API.
   */
  @Can("manage", "User")
  @Post(":id/update")
  async updateUser(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: { name?: string; email?: string },
  ): Promise<{ updated: true }> {
    const data: Record<string, string> = {};
    if (body.name?.trim()) data.name = body.name.trim();
    if (body.email?.trim()) data.email = body.email.trim().toLowerCase();
    if (Object.keys(data).length === 0) {
      throw new BadRequestException("Provide name or email.");
    }
    await this.callBaAdmin(req, "update-user", { userId: id, data });
    return { updated: true };
  }

  /**
   * `POST /admin/users/:id/ban` — ban (lock) a user via the BA admin
   * API. Requires a running BA instance with the admin plugin enabled.
   */
  @Can("manage", "User")
  @Post(":id/ban")
  async banUser(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: { reason?: string } | undefined,
  ): Promise<{ banned: true }> {
    await this.callBaAdmin(req, "ban-user", {
      userId: id,
      ...(body?.reason ? { banReason: body.reason } : {}),
    });
    return { banned: true };
  }

  /**
   * `POST /admin/users/:id/unban` — unban (unlock) a user via the BA
   * admin API.
   */
  @Can("manage", "User")
  @Post(":id/unban")
  async unbanUser(@Req() req: Request, @Param("id") id: string): Promise<{ banned: false }> {
    await this.callBaAdmin(req, "unban-user", { userId: id });
    return { banned: false };
  }

  /**
   * `POST /admin/users/:id/revoke-sessions` — revoke all sessions for
   * a user via the BA admin API.
   */
  @Can("manage", "User")
  @Post(":id/revoke-sessions")
  async revokeUserSessions(
    @Req() req: Request,
    @Param("id") id: string,
  ): Promise<{ revoked: true }> {
    await this.callBaAdmin(req, "revoke-user-sessions", { userId: id });
    return { revoked: true };
  }

  // ── Helpers ───────────────────────────────────────────────────────

  /**
   * Resolves the organization used for role assignment on `/admin/users`.
   * Prefers the operator session's active org, then their first membership,
   * then the oldest organization row (single-tenant seed fallback).
   */
  private async resolveAssignmentOrganization(
    req: AuthenticatedRequest,
  ): Promise<{ organizationId: string; organizationName: string }> {
    const operator = req.user;
    if (operator?.id) {
      const fromSession = await resolveHubOperatorTenantId(operator, this.prisma);
      if (fromSession) {
        const org = await this.prisma.organization.findUnique({
          where: { id: fromSession },
          select: { id: true, name: true },
        });
        if (org) {
          return { organizationId: org.id, organizationName: org.name };
        }
      }
    }

    const fallback = await this.prisma.organization.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    });
    if (!fallback) {
      throw new BadRequestException(
        "No organization exists — run seed or create an organization before assigning roles.",
      );
    }
    return { organizationId: fallback.id, organizationName: fallback.name };
  }

  /**
   * Forward a mutating action to the Better-Auth admin HTTP API.
   * Uses the loopback address so the BA lifecycle hooks (event
   * emission, audit hooks) still fire even though this is a
   * server-side call.
   *
   * Falls back to a `BadRequestException` when the BA instance is not
   * wired (BETTER_AUTH_SECRET not set or adminPlugin disabled).
   */
  private async callBaAdmin(
    req: Request,
    action: "ban-user" | "unban-user" | "revoke-user-sessions" | "create-user" | "update-user",
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.auth) {
      throw new BadRequestException("Better Auth is not configured; user actions are unavailable.");
    }

    const baseUrl = this.config.server.baseUrl ?? "http://localhost:3000";
    const url = `${baseUrl}/api/auth/admin/${action}`;

    const headers: Record<string, string> = { "content-type": "application/json" };
    // Better-Auth admin routes reject requests without Origin (browser sends it;
    // loopback server-to-server calls must mirror it).
    const origin =
      typeof req.headers.origin === "string" && req.headers.origin.length > 0
        ? req.headers.origin
        : baseUrl;
    headers.origin = origin;
    if (typeof req.headers.referer === "string" && req.headers.referer.length > 0) {
      headers.referer = req.headers.referer;
    }

    const cookie = req.headers.cookie;
    if (typeof cookie === "string" && cookie.length > 0) {
      headers.cookie = cookie;
    } else {
      const adminToken = process.env.BETTER_AUTH_ADMIN_TOKEN;
      if (adminToken) {
        headers.authorization = `Bearer ${adminToken}`;
      } else {
        throw new BadRequestException(
          "Better Auth admin session missing — sign in as a user with the admin role.",
        );
      }
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new BadRequestException(
        `User action failed (${res.status})${text ? `: ${text.slice(0, 240)}` : ""}`,
      );
    }
  }
}

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
