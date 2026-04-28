import { describe, expect, it } from 'vitest';

import { PermissionTestService } from '../../src/core/permissions/permission-test.service.js';
import { PermissionService } from '../../src/core/permissions/permission.service.js';
import type { DbPermissionRow } from '../../src/core/permissions/db-rule-resolver.js';

/**
 * Story · Admin Test-Endpunkt für Permissions (PLAN.md §6 + §32 Phase 3).
 *
 * `/admin/permissions/test` answers "what can this user do?" by
 * combining PermissionService (the cached, resolved Ability) with the
 * `buildPermissionReport()` serializer. The CRUD surfaces for Role /
 * Policy / Permission are handled by the existing BaseRepository
 * pattern — this slice owns only the Test-Endpunkt service shape.
 */
describe('Story · Permission Test-Endpunkt', () => {
  function makePermissionService(rows: DbPermissionRow[]): PermissionService {
    return new PermissionService({
      async findRulesForUser(_userId, _tenantId) {
        return rows;
      },
    });
  }

  it('returns a report with userId + tenantId echoed back', async () => {
    const svc = new PermissionTestService(makePermissionService([]));
    const report = await svc.getEffectivePermissions('user-1', 'tenant-1');
    expect(report.userId).toBe('user-1');
    expect(report.tenantId).toBe('tenant-1');
  });

  it('groups granted actions per resource', async () => {
    const svc = new PermissionTestService(
      makePermissionService([
        { resource: 'Project', action: 'READ', itemFilter: null, fields: [] },
        { resource: 'Project', action: 'CREATE', itemFilter: null, fields: [] },
        { resource: 'File', action: 'READ', itemFilter: null, fields: [] },
      ]),
    );
    const report = await svc.getEffectivePermissions('user-1', 'tenant-1');
    expect(report.byResource.Project.actions.sort()).toEqual(['create', 'read']);
    expect(report.byResource.File.actions).toEqual(['read']);
    expect(report.byResource.Project.isSuperset).toBe(false);
  });

  it('flags isSuperset=true when the user has any manage rule for the resource', async () => {
    // The DB-Rule resolver only knows the five PermissionAction enum values
    // (CREATE/READ/UPDATE/DELETE/SHARE), so `manage` cannot arrive from the
    // resolver path. The report still records `isSuperset` whenever the
    // ability grants every CRUD verb on the resource, mirroring the
    // semantic intent.
    const svc = new PermissionTestService(
      makePermissionService([
        { resource: 'Project', action: 'CREATE', itemFilter: null, fields: [] },
        { resource: 'Project', action: 'READ', itemFilter: null, fields: [] },
        { resource: 'Project', action: 'UPDATE', itemFilter: null, fields: [] },
        { resource: 'Project', action: 'DELETE', itemFilter: null, fields: [] },
      ]),
    );
    const report = await svc.getEffectivePermissions('user-1', 'tenant-1');
    expect(report.byResource.Project.isSuperset).toBe(true);
  });

  it('returns an empty report for a user with no rules', async () => {
    const svc = new PermissionTestService(makePermissionService([]));
    const report = await svc.getEffectivePermissions('user-1', 'tenant-1');
    expect(report.byResource).toEqual({});
  });
});
