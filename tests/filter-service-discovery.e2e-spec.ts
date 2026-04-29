import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FilterFor, type FilterService, FilterServiceRegistry } from '../src/core/permissions/filter-service.js';
import { FiltersModule } from '../src/core/permissions/filters.module.js';

@Injectable()
@FilterFor('Project')
class ProjectFilter implements FilterService<{ name: string }> {
  filter(value: { name: string }): { name: string } {
    return { ...value, name: value.name.toUpperCase() };
  }
}

@Injectable()
@FilterFor('Widget')
class WidgetFilter implements FilterService<{ id: string; secret?: string }> {
  filter(value: { id: string; secret?: string }): { id: string } {
    const { secret: _secret, ...rest } = value;
    void _secret;
    return rest;
  }
}

@Module({
  imports: [FiltersModule],
  providers: [ProjectFilter, WidgetFilter],
})
class TestFiltersModule {}

/**
 * `FiltersModule` auto-discovers `@FilterFor()`-decorated providers
 * via NestJS' DiscoveryService and registers them in the
 * `FilterServiceRegistry` during `onApplicationBootstrap`.
 */
describe('FiltersModule · auto-discovery', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let nestApp: any;
  let registry: FilterServiceRegistry;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestFiltersModule],
    }).compile();
    nestApp = moduleRef.createNestApplication({ logger: false });
    await nestApp.init();
    registry = nestApp.get(FilterServiceRegistry);
  });

  afterAll(async () => {
    await nestApp.close();
  });

  it('registers @FilterFor providers automatically', async () => {
    const filtered = await registry.applyFilter('Project', { name: 'foo' });
    expect(filtered).toEqual({ name: 'FOO' });
  });

  it('dispatches by subject — different filter per @FilterFor()', async () => {
    const filtered = await registry.applyFilter('Widget', { id: '1', secret: 'gone' });
    expect(filtered).toEqual({ id: '1' });
    expect(filtered).not.toHaveProperty('secret');
  });

  it('passes through unchanged when no filter is registered for the subject', async () => {
    const original = { id: '1', value: 'x' };
    const filtered = await registry.applyFilter('Unregistered', original);
    expect(filtered).toEqual(original);
  });
});
