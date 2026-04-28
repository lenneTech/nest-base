import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { buildAbility, type Ability } from '../../src/core/permissions/casl-ability.js';
import { Can, CanGuard, CAN_METADATA_KEY } from '../../src/core/permissions/can.guard.js';

/**
 * Story · @Can() + CanGuard + @Ability() (PLAN.md §32 Phase 3).
 *
 * Decorator/Guard pair gates handlers by `(action, subject)`. The
 * Guard reads metadata + the active Ability (attached to the request
 * by the upcoming PermissionInterceptor) and either lets the request
 * through or throws ForbiddenException.
 */
describe('Story · @Can() + CanGuard', () => {
  function makeContext(ability: Ability | undefined, handler: unknown): ExecutionContext {
    const req = { ability };
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
        getNext: () => null,
      }),
      getHandler: () => handler,
      getClass: () => class {},
      getType: () => 'http',
    } as unknown as ExecutionContext;
  }

  describe('@Can() metadata', () => {
    it('attaches (action, subject) on the target', () => {
      class C {
        @Can('read', 'Project')
        listProjects(): void {}
      }
      const reflector = new Reflector();
      const meta = reflector.get(CAN_METADATA_KEY, C.prototype.listProjects);
      expect(meta).toEqual({ action: 'read', subject: 'Project' });
    });
  });

  describe('CanGuard.canActivate()', () => {
    it('passes when the ability allows the (action, subject)', async () => {
      const ability = buildAbility([{ action: 'read', subject: 'Project' }]);
      const guard = new CanGuard(new Reflector());
      const ctx = makeContext(ability, () => {});
      Reflect.defineMetadata(CAN_METADATA_KEY, { action: 'read', subject: 'Project' }, ctx.getHandler());
      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
    });

    it('throws ForbiddenException when the ability denies', async () => {
      const ability = buildAbility([{ action: 'read', subject: 'Project' }]);
      const guard = new CanGuard(new Reflector());
      const ctx = makeContext(ability, () => {});
      Reflect.defineMetadata(CAN_METADATA_KEY, { action: 'delete', subject: 'Project' }, ctx.getHandler());
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('passes through when no @Can() metadata is present (no gate, no decision)', async () => {
      const guard = new CanGuard(new Reflector());
      const ctx = makeContext(undefined, () => {});
      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
    });

    it('throws ForbiddenException when @Can() is set but no ability is attached to the request', async () => {
      const guard = new CanGuard(new Reflector());
      const ctx = makeContext(undefined, () => {});
      Reflect.defineMetadata(CAN_METADATA_KEY, { action: 'read', subject: 'Project' }, ctx.getHandler());
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });
});
