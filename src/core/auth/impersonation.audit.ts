/**
 * Impersonation audit event builder (SC.SUB.16).
 *
 * Pure builder for the canonical audit-log envelope emitted when an
 * admin impersonates another user (or stops impersonating). Wired
 * into CF.AUDIT.01's existing audit-log pipeline; the impersonation
 * controller (managed by Better-Auth's `admin` plugin — CF.AUTH.05)
 * calls this builder once per lifecycle event.
 *
 * Why a builder rather than ad-hoc audit calls:
 *   - Type-safe metadata via discriminated union: each event kind
 *     carries the fields the audit-log UI's filter dropdown expects
 *     (`IMPERSONATION_START` / `IMPERSONATION_STOP`).
 *   - Single attest point for the "actor → resource" framing —
 *     impersonation rows read as "admin INVOKE'd a Session for user X".
 *   - Self-impersonation guard at construction time so a buggy
 *     controller can't emit a meaningless event.
 *
 * Hard rule: `impersonatedBy` mirrors `actorUserId` in metadata so
 * audit-log filters can pivot on either field — looking up "every
 * action admin-1 took as another user" hits the same row whether
 * the operator queries `actorUserId = admin-1` or
 * `metadata.impersonatedBy = admin-1`.
 */

interface CommonContext {
  /** UUID of the admin actor performing the impersonation. */
  readonly adminUserId: string;
  /** UUID of the user being impersonated. */
  readonly impersonatedUserId: string;
  /** Tenant scope of the action. */
  readonly tenantId: string;
  /** IP address that triggered the action. */
  readonly ipAddress: string;
  /** Wall-clock ms epoch when the action happened. */
  readonly occurredAt: number;
}

export type ImpersonationAuditInput =
  | (CommonContext & {
      readonly kind: "start";
      /** Session id minted for the impersonation. */
      readonly newSessionId: string;
    })
  | (CommonContext & {
      readonly kind: "stop";
      /** Session id being torn down. */
      readonly sessionId: string;
    });

export type ImpersonationAuditMetadataKind = "IMPERSONATION_START" | "IMPERSONATION_STOP";

export interface ImpersonationAuditEvent {
  readonly action: "INVOKE";
  readonly resource: "Session";
  readonly resourceId: string;
  readonly actorUserId: string;
  readonly tenantId: string;
  readonly ipAddress: string;
  readonly occurredAt: number;
  readonly metadata: {
    readonly kind: ImpersonationAuditMetadataKind;
    readonly impersonatedUserId: string;
    readonly impersonatedBy: string;
  };
}

export class ImpersonationAuditInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImpersonationAuditInputError";
  }
}

export function buildImpersonationAuditEvent(
  input: ImpersonationAuditInput,
): ImpersonationAuditEvent {
  if (input.adminUserId === input.impersonatedUserId) {
    throw new ImpersonationAuditInputError(
      "impersonation audit: self-impersonation is not a meaningful action",
    );
  }

  const sessionId = input.kind === "start" ? input.newSessionId : input.sessionId;
  if (!sessionId || sessionId.trim() === "") {
    throw new ImpersonationAuditInputError("impersonation audit: session id is required");
  }

  const metadataKind: ImpersonationAuditMetadataKind =
    input.kind === "start" ? "IMPERSONATION_START" : "IMPERSONATION_STOP";

  return {
    action: "INVOKE",
    resource: "Session",
    resourceId: sessionId,
    actorUserId: input.adminUserId,
    tenantId: input.tenantId,
    ipAddress: input.ipAddress,
    occurredAt: input.occurredAt,
    metadata: {
      kind: metadataKind,
      impersonatedUserId: input.impersonatedUserId,
      impersonatedBy: input.adminUserId,
    },
  };
}
