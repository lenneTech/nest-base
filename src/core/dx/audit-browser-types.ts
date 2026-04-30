/**
 * Read-model types for the `/admin/audit` page.
 *
 * Shared between the JSON sidecar in `admin-spa.controller.ts` and the
 * React page. Diffs are rendered as line-prefixed JSON snippets.
 */

export type AuditAction = "create" | "update" | "delete" | string;

export interface AuditLogEntry {
  id: string;
  action: AuditAction;
  resource: string;
  resourceId?: string;
  actorUserId?: string;
  tenantId?: string;
  occurredAt: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface AuditBrowserFilter {
  action?: string;
  resource?: string;
  actorUserId?: string;
  from?: string;
  to?: string;
}

export interface AuditBrowserPageInput {
  entries: AuditLogEntry[];
  filter: AuditBrowserFilter;
}
