-- AuditAction enum: add REVOKE for session-revocation events
-- (CF.AUTH.SESSIONS — iter-90). The default SessionRevokeAuditSink
-- writes audit_log rows with action='REVOKE' +
-- metadata.kind='SESSION_REVOKED' + metadata.strategy=<...> so the
-- Audit Browser can pivot on either field.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'REVOKE';
