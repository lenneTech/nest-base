import { Injectable } from "@nestjs/common";

import { loadFeatures } from "../features/features.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { ImpersonationAuditSink } from "./impersonation.controller.js";
import type {
  ImpersonationAuditEvent,
  ImpersonationAuditMetadataKind,
} from "./impersonation.audit.js";

/**
 * Default `ImpersonationAuditSink` implementation that writes
 * impersonation lifecycle events to the `audit_log` table
 * (SC.SUB.16). The PRD pins "Story test impersonates target user …
 * verifies … INVOKE audit row with kind: IMPERSONATION_START" — this
 * sink is the binding that materialises that row out-of-the-box,
 * removing the need for every consuming project to override the
 * `IMPERSONATION_AUDIT_SINK` token themselves.
 *
 * Why `$executeRaw` instead of `prisma.auditLog.create`: Prisma 7 +
 * Nest's IoC wrapping leave model delegates undefined inside class
 * methods on the underlying instance (the same Proxy issue documented
 * in iter-84's `prisma.service.ts` audit-write path). Routing
 * through `$executeRaw` against the canonical `audit_log` table maps
 * the impersonation event 1:1 to columns + jsonb metadata without
 * relying on the delegate accessor.
 *
 * Feature gating: when `features.audit.enabled === false`, `emit`
 * silently no-ops. The audit subsystem is default-on; projects that
 * intentionally disable it (storage budget, regulatory archive
 * elsewhere) keep the controller path functional but skip the row.
 */
@Injectable()
export class DefaultImpersonationAuditSink implements ImpersonationAuditSink {
  constructor(private readonly prisma: PrismaService) {}

  async emit(event: ImpersonationAuditEvent): Promise<void> {
    const features = loadFeatures(process.env as Record<string, string | undefined>);
    if (!features.audit.enabled) return;

    const metadataPayload: Record<string, unknown> = {
      ...event.metadata,
      ipAddress: event.ipAddress,
    };
    const metadataJson = JSON.stringify(metadataPayload);
    const occurredAtIso = new Date(event.occurredAt).toISOString();

    // Note: action='INVOKE' relies on the iter-86 enum migration
    // (`prisma/migrations/20260505080000_audit_action_invoke/`).
    // The diff column is required (NOT NULL) so we record the
    // canonical envelope shape — empty object is the "no shape change"
    // marker the Audit Browser renders as a kind-only entry.
    await this.prisma.$executeRaw`
      INSERT INTO audit_log
        (id, tenant_id, actor_user_id, target_model, target_id, action, diff, metadata, created_at)
      VALUES
        (gen_random_uuid(),
         ${event.tenantId}::uuid,
         ${event.actorUserId}::uuid,
         ${event.resource},
         ${event.resourceId},
         ${event.action}::audit_action,
         '{}'::jsonb,
         ${metadataJson}::jsonb,
         ${occurredAtIso}::timestamp)
    `;
  }
}

/** Type guard surfaced for callers that want to assert metadata.kind. */
export function isImpersonationKind(value: unknown): value is ImpersonationAuditMetadataKind {
  return value === "IMPERSONATION_START" || value === "IMPERSONATION_STOP";
}
