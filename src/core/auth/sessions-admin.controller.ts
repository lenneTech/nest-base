import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";

import { buildDevPortalShellInput, renderDevPortalShell } from "../dx/dev-portal-shell.js";
import { Can } from "../permissions/can.guard.js";
import { Public } from "../permissions/public.decorator.js";
import { BETTER_AUTH_INSTANCE, type BetterAuthInstance } from "./better-auth.token.js";
import {
  planSessionRevoke,
  type SessionRecord,
  type SessionRevokeStrategy,
} from "./sessions-admin.planner.js";

/**
 * SessionsAdminController — `/admin/sessions` (CF.AUTH.SESSIONS).
 *
 * Backs the PRD's "Sessions admin (revoke single / bulk-by-user)"
 * surface. The Better-Auth admin plugin (mounted via the JWT
 * `audience: "admin"` flow) handles authentication and identity;
 * the routes here add the project's revocation strategies on top
 * of Better-Auth's session storage.
 *
 * The controller delegates the policy decision to
 * `planSessionRevoke()` (pure planner) and the actual storage I/O
 * to a `SessionRevokeStorage` provider — production code binds this
 * to the Better-Auth Prisma adapter, story tests pass an in-memory
 * fake.
 *
 * RBAC:
 *   - `delete:Session` is required for every endpoint. The
 *     CASL `Administrator` role grants it via `manage all`; member-
 *     scoped roles never satisfy it (no impersonate/admin power).
 *
 * Audit:
 *   - The runner emits an audit row per revoked session via the
 *     `auditSink` callback. Shape mirrors `impersonation.audit.ts`
 *     so the Audit Browser can group both surfaces under
 *     `Session` resource.
 */

export interface SessionRevokeStorage {
  /**
   * List sessions. Pass `tenantId` to scope results to a single tenant so
   * admins cannot observe sessions across tenant boundaries (H3 fix).
   *
   * @param tenantId - When `undefined`, returns sessions for all tenants
   *   (single-tenant deployments). Implementations must not throw on undefined.
   */
  readonly listAllSessions: (tenantId?: string) => Promise<readonly SessionRecord[]>;
  readonly revokeSession: (sessionId: string) => Promise<void>;
}

export interface SessionRevokeAuditSink {
  /**
   * Called once per revoked session. The implementer routes to the
   * project's audit-log writer (typically the bare-Prisma `auditLog`
   * delegate to bypass the soft-delete extension chain).
   */
  readonly emit: (event: SessionRevokedAuditEvent) => Promise<void>;
}

export interface SessionRevokedAuditEvent {
  readonly action: "REVOKE";
  readonly resource: "Session";
  readonly resourceId: string;
  readonly actorUserId: string;
  readonly tenantId: string;
  readonly occurredAt: number;
  readonly metadata: {
    readonly kind: "SESSION_REVOKED";
    readonly strategy: SessionRevokeStrategy["kind"];
  };
}

export const SESSION_REVOKE_STORAGE = Symbol.for("lt:SessionRevokeStorage");
export const SESSION_REVOKE_AUDIT_SINK = Symbol.for("lt:SessionRevokeAuditSink");

interface AuthedRequest extends Request {
  readonly user?: { readonly id: string; readonly tenantId?: string };
  readonly headers: Request["headers"] & { readonly "x-session-id"?: string };
}

@Controller("admin/sessions")
export class SessionsAdminController {
  constructor(
    @Inject(SESSION_REVOKE_STORAGE) private readonly storage: SessionRevokeStorage,
    @Inject(SESSION_REVOKE_AUDIT_SINK) private readonly audit: SessionRevokeAuditSink,
    @Optional()
    @Inject(BETTER_AUTH_INSTANCE)
    private readonly auth: BetterAuthInstance | null = null,
  ) {}

  /**
   * `GET /admin/sessions` — Sessions admin SPA HTML shell.
   *
   * `@Public()` here is intentional: the HTML shell is a static React
   * SPA container that carries no sensitive data — it is equivalent to
   * loading a static `.html` file. All data-bearing endpoints that
   * follow (`sessionsListJson`, `revokeSingle`, `revokeBulkByUser`,
   * `revokeOthers`) are individually gated by `@Can("delete",
   * "Session")`. The same pattern is used by `/admin/users`,
   * `/admin/realtime`, and all dev-hub shells (H4: confirmed
   * intentional — security review 2026-05).
   */
  @Public("dev-portal SPA shell — every interactive payload below is gated separately")
  @Get()
  @Header("content-type", "text/html; charset=utf-8")
  sessionsAdminPage(): string {
    return renderDevPortalShell(
      buildDevPortalShellInput({ title: "Sessions Admin", brand: "central" }),
    );
  }

  /**
   * `GET /admin/sessions.json` — list every active session known to
   * the wired storage adapter. Iter-108 surfaces the Better-Auth
   * Prisma adapter's session inventory (or an empty list when the
   * default no-op adapter is in place) so the SPA Sessions page can
   * render the table without a separate Better-Auth admin call.
   */
  @Can("delete", "Session")
  @Get("list.json")
  async sessionsListJson(
    @Req() req: AuthedRequest,
  ): Promise<{ sessions: readonly SessionRecord[] }> {
    // Scope to the requesting admin's tenant so cross-tenant session
    // enumeration is impossible (H3 fix).
    const sessions = await this.storage.listAllSessions(req.user?.tenantId);
    return { sessions };
  }

  /**
   * `DELETE /admin/sessions/:sessionId` — single-session revoke.
   * Used by the user's own "log out this device" UI as well as by
   * admins (the CASL ability layer enforces the role gate).
   */
  @Can("delete", "Session")
  @Delete(":sessionId")
  async revokeSingle(
    @Param("sessionId") sessionId: string,
    @Req() req: AuthedRequest,
  ): Promise<{ revoked: number; sessionIds: readonly string[] }> {
    if (!req.user) throw new ForbiddenException("authentication required");
    return this.executeRevoke(req, { kind: "single", sessionId });
  }

  /**
   * `POST /admin/sessions/revoke-bulk-by-user` — admin-only bulk
   * tear-down for a single user (security incident response).
   * Body: `{ userId: string }`.
   */
  @Can("delete", "Session")
  @Post("revoke-bulk-by-user")
  async revokeBulkByUser(
    @Body() body: { userId?: unknown },
    @Req() req: AuthedRequest,
  ): Promise<{ revoked: number; sessionIds: readonly string[] }> {
    if (!req.user) throw new ForbiddenException("authentication required");
    if (!body || typeof body.userId !== "string" || body.userId.length === 0) {
      throw new BadRequestException("userId (non-empty string) is required");
    }
    return this.executeRevoke(req, { kind: "bulk-by-user", userId: body.userId });
  }

  /**
   * `POST /admin/sessions/revoke-others` — current-user "log out
   * all other devices" flow (a self-service action, not an admin
   * action).
   *
   * MAJ-4 fix: the current session id is resolved from the verified
   * Better-Auth session rather than a client-supplied `x-session-id`
   * header. A client-supplied header could reference any session id —
   * including one belonging to another user — which would exempt
   * that other session from revocation. The server-side lookup pins
   * the exempted session to the actual authenticated session.
   */
  @Can("delete", "Session")
  @Post("revoke-others")
  async revokeOthers(
    @Req() req: AuthedRequest,
  ): Promise<{ revoked: number; sessionIds: readonly string[] }> {
    if (!req.user) throw new ForbiddenException("authentication required");

    // Resolve the current session id from the verified Better-Auth session.
    // Falls back to a 401 when the auth subsystem is not wired so we never
    // accidentally trust a client-supplied value.
    if (!this.auth) {
      throw new UnauthorizedException(
        "auth subsystem not configured — cannot determine current session",
      );
    }
    const sessionLookup = await this.auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const currentSessionId = (sessionLookup as { session?: { id?: string } } | null)?.session?.id;
    if (!currentSessionId) {
      throw new UnauthorizedException("could not resolve current session id");
    }

    return this.executeRevoke(req, {
      kind: "bulk-by-user-except-current",
      userId: req.user.id,
      currentSessionId,
    });
  }

  private async executeRevoke(
    req: AuthedRequest,
    strategy: SessionRevokeStrategy,
  ): Promise<{ revoked: number; sessionIds: readonly string[] }> {
    // Pass the tenant id so only the current tenant's sessions are candidates
    // for revocation — cross-tenant revoke is not possible (H3 fix).
    const sessions = await this.storage.listAllSessions(req.user?.tenantId);
    const plan = planSessionRevoke({ sessions, strategy });
    if (plan.sessionIds.length === 0) {
      throw new NotFoundException("no matching sessions to revoke");
    }
    const now = Date.now();
    // Use "UNKNOWN" instead of "" so audit logs contain a diagnosable
    // placeholder when tenantId is missing — easier to triage than empty string.
    const tenantId = req.user?.tenantId ?? "UNKNOWN";
    for (const sessionId of plan.sessionIds) {
      await this.storage.revokeSession(sessionId);
      await this.audit.emit({
        action: "REVOKE",
        resource: "Session",
        resourceId: sessionId,
        actorUserId: req.user!.id,
        tenantId,
        occurredAt: now,
        metadata: { kind: "SESSION_REVOKED", strategy: strategy.kind },
      });
    }
    return { revoked: plan.sessionIds.length, sessionIds: plan.sessionIds };
  }
}
