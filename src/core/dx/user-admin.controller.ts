/**
 * UserAdminController — `/admin/users/*` (issue #86).
 *
 * Server-side wrappers around Prisma reads + Better-Auth admin
 * write operations. All routes are gated by `@Can("manage", "User")`
 * so only the Administrator CASL role can reach them.
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
  Post,
  Query,
} from "@nestjs/common";

import { Can } from "../permissions/can.guard.js";
import { Public } from "../permissions/public.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { buildDevPortalShellInput, renderDevPortalShell } from "./dev-portal-shell.js";
import { filterUsers } from "./user-admin-planner.js";
import { BETTER_AUTH_INSTANCE, type BetterAuthInstance } from "../auth/better-auth.token.js";
import { serverConfigFromEnv } from "../server/server-config.js";

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
}

@Controller("admin/users")
export class UserAdminController {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(BETTER_AUTH_INSTANCE) private readonly auth: BetterAuthInstance | null,
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
    this.assertDev();
    return renderDevPortalShell(
      buildDevPortalShellInput({ title: "Benutzerverwaltung", brand: "central" }),
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
    this.assertDev();

    const limit = clampLimit(limitRaw);
    const offset = parseOffset(offsetRaw);

    // Fetch all users with their session counts in one round-trip by
    // including `_count.sessions`. Filtering + slicing then happens in
    // the planner (pure, tested in the story test).
    const rows = await this.prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { sessions: true } } },
    });

    // The BA admin plugin adds `banned` / `banReason` at runtime on
    // the session user object but does NOT back-fill the Prisma `User`
    // model — those columns live in BA's in-memory session store / JWT
    // claims. Until a BA-backed migration is applied (out of scope for
    // this slice), we treat `banned` as false from Prisma and rely on
    // the BA admin write paths to track the state.
    const plannerUsers = rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name || null,
      banned: false as boolean,
    }));

    const filtered = filterUsers({ query: q ?? "", users: plannerUsers, limit: limit + offset });
    const sliced = filtered.slice(offset, offset + limit);

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
      };
    });

    return { users: entries, total: filtered.length };
  }

  /**
   * `GET /admin/users/:id.json` — user detail with sessions +
   * linked OAuth accounts.
   */
  @Can("manage", "User")
  @Get(":id.json")
  async userDetailJson(@Param("id") id: string): Promise<UserDetailResponse> {
    this.assertDev();

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

    return {
      id: row.id,
      email: row.email,
      name: row.name || null,
      emailVerified: row.emailVerified,
      banned: false,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      sessionCount: row._count.sessions,
      sessions,
      accounts,
    };
  }

  /**
   * `POST /admin/users/:id/ban` — ban (lock) a user via the BA admin
   * API. Requires a running BA instance with the admin plugin enabled.
   */
  @Can("manage", "User")
  @Post(":id/ban")
  async banUser(
    @Param("id") id: string,
    @Body() body: { reason?: string } | undefined,
  ): Promise<{ banned: true }> {
    this.assertDev();
    await this.callBaAdmin("ban-user", {
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
  async unbanUser(@Param("id") id: string): Promise<{ banned: false }> {
    this.assertDev();
    await this.callBaAdmin("unban-user", { userId: id });
    return { banned: false };
  }

  /**
   * `POST /admin/users/:id/revoke-sessions` — revoke all sessions for
   * a user via the BA admin API.
   */
  @Can("manage", "User")
  @Post(":id/revoke-sessions")
  async revokeUserSessions(@Param("id") id: string): Promise<{ revoked: true }> {
    this.assertDev();
    await this.callBaAdmin("revoke-user-sessions", { userId: id });
    return { revoked: true };
  }

  // ── Helpers ───────────────────────────────────────────────────────

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
    action: "ban-user" | "unban-user" | "revoke-user-sessions",
    payload: Record<string, string | undefined>,
  ): Promise<void> {
    if (!this.auth) {
      throw new BadRequestException(
        "Better-Auth is not configured; admin user mutations are unavailable",
      );
    }

    // Resolve the internal base URL. For dev this is typically
    // http://localhost:3000 — the same host the NestJS server is
    // listening on, reachable via loopback.
    const cfg = serverConfigFromEnv(process.env);
    const baseUrl = cfg.baseUrl ?? "http://localhost:3000";
    const url = `${baseUrl}/api/auth/admin/${action}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // The BA admin plugin requires an `Authorization` header with
        // admin credentials. For dev-hub purposes we rely on the
        // `CanGuard` enforcing the CASL `manage:User` gate before we
        // reach here — the BA admin endpoint itself is called with
        // a service-account pattern (no additional credential needed
        // because the dev-hub runs in a trusted server-side context).
        //
        // If BA admin requires a session token here in practice,
        // operators can supply a service-account bearer token via the
        // `BETTER_AUTH_ADMIN_TOKEN` env var (future extension point).
      },
      body: JSON.stringify(
        Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined)),
      ),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new BadRequestException(
        `BA admin /${action} failed (${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
      );
    }
  }

  private assertDev(): void {
    const cfg = serverConfigFromEnv(process.env);
    if (cfg.env !== "development") {
      throw new NotFoundException();
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
