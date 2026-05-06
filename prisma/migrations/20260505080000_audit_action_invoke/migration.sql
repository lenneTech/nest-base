-- AuditAction enum: add INVOKE for impersonation events (SC.SUB.16).
-- Iter-86 wires the default ImpersonationAuditSink to the audit_log
-- table via $executeRaw. Each impersonation start/stop emits an
-- audit_log row with action='INVOKE' and metadata.kind set to one of
-- IMPERSONATION_START / IMPERSONATION_STOP — the Audit Browser
-- pivots on metadata.kind to surface impersonation-specific rows.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'INVOKE';
