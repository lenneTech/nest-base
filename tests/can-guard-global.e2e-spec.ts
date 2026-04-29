import { Controller, Get } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Can, CanGuard } from '../src/core/permissions/can.guard.js';
import { PermissionInterceptor } from '../src/core/permissions/permission.interceptor.js';
import { PermissionService, type PermissionStorage } from '../src/core/permissions/permission.service.js';
import { PERMISSION_STORAGE } from '../src/core/permissions/permission-storage.token.js';

@Controller('test-perms')
class TestController {
  @Get('public')
  public(): { ok: true } {
    // No @Can() metadata — guard passes through.
    return { ok: true };
  }

  @Get('protected')
  @Can('read', 'SecretSubject')
  protected(): { ok: true } {
    return { ok: true };
  }
}

/**
 * `CanGuard` is registered globally (`APP_GUARD`) and `PermissionInterceptor`
 * resolves the `Ability` per request. Anonymous requests get an empty
 * Ability, so:
 *   - routes WITHOUT `@Can()` pass through (200)
 *   - routes WITH `@Can()` deny (403)
 *
 * Once a real auth flow attaches `request.user`, the interceptor
 * delegates to `PermissionService.abilityFor(userId, tenantId)` which
 * loads rules from the Prisma-backed storage adapter.
 */
describe('CanGuard · global registration', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let nestApp: any;

  beforeAll(async () => {
    const stub: PermissionStorage = { async findRulesForUser() { return []; } };
    const moduleRef = await Test.createTestingModule({
      controllers: [TestController],
      providers: [
        { provide: PERMISSION_STORAGE, useValue: stub },
        PermissionService,
        PermissionInterceptor,
        CanGuard,
        { provide: APP_INTERCEPTOR, useClass: PermissionInterceptor },
        { provide: APP_GUARD, useClass: CanGuard },
      ],
    }).compile();
    nestApp = moduleRef.createNestApplication({ logger: false });
    await nestApp.init();
  });

  afterAll(async () => {
    await nestApp.close();
  });

  it('routes without @Can() pass through (200)', async () => {
    const res = await request(nestApp.getHttpServer()).get('/test-perms/public');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('routes with @Can() deny anonymous requests (403)', async () => {
    const res = await request(nestApp.getHttpServer()).get('/test-perms/protected');
    expect(res.status).toBe(403);
  });
});
