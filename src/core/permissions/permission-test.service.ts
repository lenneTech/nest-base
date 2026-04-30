import {
  type PermissionReport,
  type PermissionRule,
  buildPermissionReport,
} from "./permission-report.js";
import { PermissionService } from "./permission.service.js";

/**
 * Service backing the `/admin/permissions/test` endpoint
 *.
 *
 * Combines `PermissionService.abilityFor()` (cached) with the
 * `buildPermissionReport()` serializer to answer "what can this user
 * do?". The CRUD surfaces for Role / Policy / Permission live on the
 * BaseRepository — this service owns only the test-endpoint shape.
 *
 * The CASL ability we get back from `abilityFor()` exposes the raw
 * rule list via `ability.rules`. We map them straight into the
 * `PermissionRule` shape consumed by `buildPermissionReport()` and let
 * the serializer do the per-resource grouping + superset detection.
 */

const CRUD_ACTIONS = new Set(["create", "read", "update", "delete"]);

export class PermissionTestService {
  constructor(private readonly permissions: PermissionService) {}

  async getEffectivePermissions(userId: string, tenantId: string): Promise<PermissionReport> {
    const ability = await this.permissions.abilityFor(userId, tenantId);
    const rules = ability.rules.flatMap<PermissionRule>((raw) => {
      const actions = Array.isArray(raw.action) ? raw.action : [raw.action];
      const subjects = Array.isArray(raw.subject) ? raw.subject : [raw.subject];
      const result: PermissionRule[] = [];
      for (const action of actions) {
        for (const subject of subjects) {
          result.push({ action: String(action), subject: String(subject) });
        }
      }
      return result;
    });

    const report = buildPermissionReport({ userId, tenantId, rules });
    promoteCrudCoverageToSuperset(report);
    return report;
  }
}

/**
 * If a resource carries every CRUD verb (create/read/update/delete)
 * but no explicit `manage` rule, treat it as a superset. The DB-Rule
 * resolver doesn't emit `manage` (it's not in PermissionAction), so we
 * recover the semantic intent here.
 */
function promoteCrudCoverageToSuperset(report: PermissionReport): void {
  for (const entry of Object.values(report.byResource)) {
    if (entry.isSuperset) continue;
    const actions = new Set(entry.actions);
    let hasAll = true;
    for (const verb of CRUD_ACTIONS) {
      if (!actions.has(verb)) {
        hasAll = false;
        break;
      }
    }
    if (hasAll) entry.isSuperset = true;
  }
}
