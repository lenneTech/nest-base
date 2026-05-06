import { Injectable } from "@nestjs/common";

import { loadFeatures } from "../features/features.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type {
  SessionRevokeAuditSink,
  SessionRevokedAuditEvent,
} from "./sessions-admin.controller.js";

/**
 * Default `SessionRevokeAuditSink` implementation that writes
 * session-revocation events to the `audit_log` table
 * (CF.AUTH.SESSIONS, parallel to iter-86's impersonation sink).
 *
 * Per-revoked-session emission shape:
 *   - `action = 'REVOKE'` (iter-90 enum extension)
 *   - `target_model = 'Session'`
 *   - `target_id = <revoked session id>`
 *   - `metadata = {kind: 'SESSION_REVOKED', strategy, ipAddress?}`
 *
 * Feature gating: `features.audit.enabled === false` → emit silently
 * skips so projects that intentionally disable audit don't crash the
 * revoke flow. Same pattern + `$executeRaw` choice as the
 * impersonation sink (avoids the Prisma model-delegate accessor
 * issue documented in iter-84).
 */
@Injectable()
export class DefaultSessionRevokeAuditSink implements SessionRevokeAuditSink {
  constructor(private readonly prisma: PrismaService) {}

  async emit(event: SessionRevokedAuditEvent): Promise<void> {
    const features = loadFeatures(process.env as Record<string, string | undefined>);
    if (!features.audit.enabled) return;

    const metadataPayload: Record<string, unknown> = {
      ...event.metadata,
    };
    const metadataJson = JSON.stringify(metadataPayload);
    const occurredAtIso = new Date(event.occurredAt).toISOString();

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
