/**
 * Permission report serializer.
 *
 * Aggregates raw CASL rules into a per-resource summary suitable for
 * the `/hub/admin/permissions/test` endpoint. The `manage` action marks
 * the resource as a superset (covers all CRUD verbs).
 */

export interface PermissionRule {
  action: string;
  subject: string;
}

export interface ResourceReport {
  actions: string[];
  isSuperset: boolean;
}

export interface PermissionReport {
  userId: string;
  tenantId: string;
  byResource: Record<string, ResourceReport>;
}

export interface BuildReportInput {
  userId: string;
  tenantId: string;
  rules: PermissionRule[];
}

const SUPERSET_ACTION = "manage";

export function buildPermissionReport(input: BuildReportInput): PermissionReport {
  const byResource: Record<string, ResourceReport> = {};

  for (const rule of input.rules) {
    const entry = byResource[rule.subject] ?? { actions: [], isSuperset: false };
    if (rule.action === SUPERSET_ACTION) {
      entry.isSuperset = true;
    }
    if (!entry.actions.includes(rule.action)) {
      entry.actions.push(rule.action);
    }
    byResource[rule.subject] = entry;
  }

  return { userId: input.userId, tenantId: input.tenantId, byResource };
}
