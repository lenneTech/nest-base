import { describe, expect, it } from 'vitest';

import {
  FILTER_FOR_METADATA,
  FilterFor,
  FilterServiceRegistry,
  type FilterService,
} from '../../src/core/permissions/filter-service.js';

/**
 * Story · Filter-Service Pattern (PLAN.md §22)
 *
 *   @FilterFor('Project')
 *   @Injectable()
 *   class ProjectFilter implements FilterService<Project> { ... }
 *
 * The registry collects all `@FilterFor()`-decorated services and
 * dispatches `applyFilter(subject, value, ctx)` to the matching one.
 * Auto-discovery walks an injected list of providers (NestJS
 * DiscoveryService integration is a separate slice).
 */
describe('Story · Filter-Service Pattern', () => {
  it('@FilterFor(subject) sets metadata on the class', () => {
    @FilterFor('Project')
    class ProjectFilter {}
    expect(Reflect.getMetadata(FILTER_FOR_METADATA, ProjectFilter)).toBe('Project');
  });

  describe('FilterServiceRegistry', () => {
    it('register() throws when the class has no @FilterFor()', () => {
      class NoMeta {}
      const reg = new FilterServiceRegistry();
      expect(() => reg.register(new NoMeta() as unknown as FilterService<unknown>, NoMeta)).toThrow(
        /@FilterFor/,
      );
    });

    it('register() throws on a duplicate subject (collision is a wiring bug)', () => {
      @FilterFor('Project')
      class A implements FilterService<unknown> {
        async filter<T>(value: T): Promise<T> {
          return value;
        }
      }
      @FilterFor('Project')
      class B implements FilterService<unknown> {
        async filter<T>(value: T): Promise<T> {
          return value;
        }
      }
      const reg = new FilterServiceRegistry();
      reg.register(new A(), A);
      expect(() => reg.register(new B(), B)).toThrow(/Project/);
    });

    it('get() returns the registered service for the subject', () => {
      @FilterFor('Project')
      class Filter implements FilterService<unknown> {
        async filter<T>(value: T): Promise<T> {
          return value;
        }
      }
      const reg = new FilterServiceRegistry();
      const svc = new Filter();
      reg.register(svc, Filter);
      expect(reg.get('Project')).toBe(svc);
    });

    it('get() returns undefined when no service is registered for the subject', () => {
      const reg = new FilterServiceRegistry();
      expect(reg.get('Unknown')).toBeUndefined();
    });
  });

  describe('applyFilter()', () => {
    it('dispatches to the registered service and returns its result', async () => {
      @FilterFor('User')
      class UserFilter implements FilterService<{ id: string; secret?: string }> {
        async filter(value: { id: string; secret?: string }): Promise<{ id: string; secret?: string }> {
          const { secret: _secret, ...rest } = value;
          return rest;
        }
      }
      const reg = new FilterServiceRegistry();
      reg.register(new UserFilter(), UserFilter);
      const out = await reg.applyFilter('User', { id: '1', secret: 'x' });
      expect(out).toEqual({ id: '1' });
    });

    it('returns the value untouched when no service matches the subject', async () => {
      const reg = new FilterServiceRegistry();
      const out = await reg.applyFilter('Project', { id: '1' });
      expect(out).toEqual({ id: '1' });
    });
  });

  describe('auto-discovery', () => {
    it('FilterServiceRegistry.fromInstances() registers each entry', () => {
      @FilterFor('Project')
      class P implements FilterService<unknown> {
        async filter<T>(v: T): Promise<T> {
          return v;
        }
      }
      @FilterFor('User')
      class U implements FilterService<unknown> {
        async filter<T>(v: T): Promise<T> {
          return v;
        }
      }
      const reg = FilterServiceRegistry.fromInstances([
        { instance: new P(), ctor: P },
        { instance: new U(), ctor: U },
      ]);
      expect(reg.get('Project')).toBeDefined();
      expect(reg.get('User')).toBeDefined();
    });

    it('fromInstances() ignores entries without @FilterFor() metadata', () => {
      class Plain {}
      const reg = FilterServiceRegistry.fromInstances([{ instance: new Plain(), ctor: Plain }]);
      expect(reg.get('Plain')).toBeUndefined();
    });
  });
});
