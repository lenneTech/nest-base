import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";

import { requireSessionTenantId } from "../multi-tenancy/resolve-session-tenant.js";
import { Can } from "../permissions/can.guard.js";
import {
  buildImpersonationAuditEvent,
  type ImpersonationAuditEvent,
} from "./impersonation.audit.js";

/**
 * ImpersonationController — `/hub/admin/impersonation/stop` (CF.AUTH.IMPERSONATION).
 *
 * Backs the PRD's "Impersonation: Session.impersonatedBy +
 * IMPERSONATION_START / STOP audit envelopes" requirement
 * (SC.SUB.16). The Better-Auth admin plugin (mounted via the JWT
 * `audience: "admin"` flow) emits the START envelope when the
 * admin enters impersonation; the controller here emits STOP when
 * the admin exits + tears down the impersonation session.
 *
 * RBAC: gated by `delete:Session` (same ability the bulk
 * revocation paths use). The CASL `Administrator` role grants it;
 * member-scoped roles never satisfy it.
 *
 * Audit shape mirrors `impersonation.audit.ts > buildImpersonationAuditEvent`
 * — the controller delegates the event construction to the planner
 * to keep the audit-row shape fully testable without HTTP.
 */

export interface ImpersonationAuditSink {
  /** Routes the planner-emitted event to the project's audit-log writer. */
  readonly emit: (event: ImpersonationAuditEvent) => Promise<void>;
}

export interface ImpersonationSessionTeardown {
  /** Tears down the impersonation session in Better-Auth's storage. */
  readonly endImpersonation: (sessionId: string) => Promise<void>;
}

export const IMPERSONATION_AUDIT_SINK = Symbol.for("lt:ImpersonationAuditSink");
export const IMPERSONATION_TEARDOWN = Symbol.for("lt:ImpersonationTeardown");

interface AuthedRequest extends Request {
  readonly user?: { readonly id: string; readonly activeOrganizationId?: string | null };
}

interface ImpersonationStopBody {
  readonly impersonatedUserId?: unknown;
  readonly sessionId?: unknown;
  readonly ipAddress?: unknown;
}

@Controller("hub/admin/impersonation")
export class ImpersonationController {
  constructor(
    @Inject(IMPERSONATION_AUDIT_SINK)
    private readonly audit: ImpersonationAuditSink,
    @Inject(IMPERSONATION_TEARDOWN)
    private readonly teardown: ImpersonationSessionTeardown,
  ) {}

  /**
   * `POST /hub/admin/impersonation/stop` — exit impersonation flow.
   *
   * Body: `{ impersonatedUserId: string, sessionId: string,
   * ipAddress?: string }`. Emits the IMPERSONATION_STOP audit row
   * with the admin (req.user.id) as actor and the impersonated
   * user as `impersonatedUserId`. Then tears down the impersonation
   * session.
   *
   * The impersonatedUserId arg lets the audit envelope cite the
   * filter pivot the Audit Browser uses to surface "actions taken
   * while impersonating user X".
   */
  @Can("delete", "Session")
  @Post("stop")
  async stop(
    @Body() body: ImpersonationStopBody,
    @Req() req: AuthedRequest,
  ): Promise<{ stopped: true; auditEmitted: true }> {
    if (!req.user) throw new ForbiddenException("authentication required");
    if (
      !body ||
      typeof body.impersonatedUserId !== "string" ||
      body.impersonatedUserId.length === 0
    ) {
      throw new BadRequestException("impersonatedUserId (non-empty string) is required");
    }
    if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
      throw new BadRequestException("sessionId (non-empty string) is required");
    }
    const ipAddress =
      typeof body.ipAddress === "string" && body.ipAddress.length > 0
        ? body.ipAddress
        : (req.ip ?? req.socket.remoteAddress ?? "");

    const event = buildImpersonationAuditEvent({
      kind: "stop",
      adminUserId: req.user.id,
      impersonatedUserId: body.impersonatedUserId,
      tenantId: requireSessionTenantId(req),
      ipAddress,
      sessionId: body.sessionId,
      occurredAt: Date.now(),
    });
    await this.audit.emit(event);
    await this.teardown.endImpersonation(body.sessionId);
    return { stopped: true, auditEmitted: true };
  }
}
