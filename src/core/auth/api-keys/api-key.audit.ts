/**
 * API key audit trail event builder (CF.AUTH.19).
 *
 * Pure builder for the canonical audit-log entry that the API-key
 * service emits on every meaningful lifecycle event. The actual
 * audit-log persistence happens via CF.AUDIT.01's
 * `audit-log.service.ts` — this slice owns only the event shape so
 * the API-key service has a single, type-safe call site for emitting.
 *
 * Why a discriminated union: keeps the metadata for each operation
 * type explicit (revoke has `reason`, rotate has `previousLookupId`,
 * etc.) without resorting to weakly-typed `Record<string, unknown>`
 * blobs. The audit-log filter UI (CF.AUDIT.07-12) can then drive
 * its action filter dropdown straight from the union members.
 *
 * Hard rule: NEVER include the plaintext secret or any hash material
 * in the event metadata. The lookupId (UUID v7) is the only
 * identifier that ever appears in an audit row.
 */

const UUID_RE = /^[0-9a-f-]{36}$/i;

interface CommonContext {
  /** UUID v7 lookup id of the affected key. */
  readonly lookupId: string;
  /** Tenant scope of the action. */
  readonly tenantId: string;
  /** IP address that triggered the action. */
  readonly ipAddress: string;
  /** Wall-clock ms epoch when the action happened. */
  readonly occurredAt: number;
  /** Optional — undefined for `verify-failed` (caller is unauthenticated). */
  readonly actorUserId?: string;
}

export type ApiKeyAuditInput =
  | (CommonContext & {
      readonly kind: "created";
      readonly ownerUserId: string;
      readonly scopes: readonly string[];
      readonly expiresAt?: number;
    })
  | (CommonContext & {
      readonly kind: "rotated";
      readonly ownerUserId: string;
      readonly previousLookupId: string;
    })
  | (CommonContext & {
      readonly kind: "revoked";
      readonly reason: string;
    })
  | (CommonContext & {
      readonly kind: "verified";
    })
  | (CommonContext & {
      readonly kind: "verify-failed";
      readonly reason: string;
    });

export type ApiKeyAuditAction =
  | "api-key.created"
  | "api-key.rotated"
  | "api-key.revoked"
  | "api-key.verified"
  | "api-key.verify-failed";

export interface ApiKeyAuditEvent {
  readonly action: ApiKeyAuditAction;
  readonly resource: "ApiKey";
  readonly resourceId: string;
  readonly actorUserId?: string;
  readonly tenantId: string;
  readonly ipAddress: string;
  readonly occurredAt: number;
  readonly metadata: Record<string, unknown>;
}

export class ApiKeyAuditInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiKeyAuditInputError";
  }
}

function assertLookupId(lookupId: string): void {
  if (!UUID_RE.test(lookupId)) {
    throw new ApiKeyAuditInputError(`api-key audit: lookupId must be a UUID, got "${lookupId}"`);
  }
}

export function buildApiKeyAuditEvent(input: ApiKeyAuditInput): ApiKeyAuditEvent {
  assertLookupId(input.lookupId);

  const base = {
    resource: "ApiKey" as const,
    resourceId: input.lookupId,
    tenantId: input.tenantId,
    ipAddress: input.ipAddress,
    occurredAt: input.occurredAt,
    ...(input.actorUserId !== undefined ? { actorUserId: input.actorUserId } : {}),
  };

  switch (input.kind) {
    case "created":
      return {
        ...base,
        action: "api-key.created",
        metadata: {
          ownerUserId: input.ownerUserId,
          scopes: [...input.scopes],
          ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
        },
      };
    case "rotated":
      assertLookupId(input.previousLookupId);
      return {
        ...base,
        action: "api-key.rotated",
        metadata: {
          ownerUserId: input.ownerUserId,
          previousLookupId: input.previousLookupId,
        },
      };
    case "revoked":
      return {
        ...base,
        action: "api-key.revoked",
        metadata: { reason: input.reason },
      };
    case "verified":
      return {
        ...base,
        action: "api-key.verified",
        metadata: {},
      };
    case "verify-failed":
      return {
        ...base,
        action: "api-key.verify-failed",
        metadata: { reason: input.reason },
      };
  }
}
