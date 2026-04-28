import { describe, expect, it } from 'vitest';

import { paginate, type Pagination } from '../../src/core/pagination/pagination.js';

/**
 * Adapted from nest-server `pagination-metadata.story.test.ts`.
 *
 * Standardized pagination envelope for list endpoints. The metadata
 * surface is what kubb generates SDK types from, so it must stay
 * stable across resources.
 */
describe('Story · Pagination metadata', () => {
  it('returns items + meta with total/page/perPage/totalPages', () => {
    const result: Pagination<number> = paginate({
      items: [1, 2, 3],
      total: 25,
      page: 2,
      perPage: 10,
    });
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.meta).toEqual({
      total: 25,
      page: 2,
      perPage: 10,
      totalPages: 3,
      hasNext: true,
      hasPrev: true,
    });
  });

  it('hasNext=false on the last page', () => {
    const result = paginate({ items: [], total: 25, page: 3, perPage: 10 });
    expect(result.meta.hasNext).toBe(false);
    expect(result.meta.hasPrev).toBe(true);
  });

  it('hasPrev=false on the first page', () => {
    const result = paginate({ items: [1], total: 25, page: 1, perPage: 10 });
    expect(result.meta.hasPrev).toBe(false);
    expect(result.meta.hasNext).toBe(true);
  });

  it('totalPages=1 when total<=perPage', () => {
    const result = paginate({ items: [1, 2, 3], total: 3, page: 1, perPage: 10 });
    expect(result.meta.totalPages).toBe(1);
    expect(result.meta.hasNext).toBe(false);
    expect(result.meta.hasPrev).toBe(false);
  });

  it('totalPages=0 when total=0 (no items at all)', () => {
    const result = paginate({ items: [], total: 0, page: 1, perPage: 10 });
    expect(result.meta).toEqual({
      total: 0,
      page: 1,
      perPage: 10,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
    });
  });

  it('rejects non-positive perPage', () => {
    expect(() => paginate({ items: [], total: 0, page: 1, perPage: 0 })).toThrow();
    expect(() => paginate({ items: [], total: 0, page: 1, perPage: -1 })).toThrow();
  });

  it('rejects non-positive page', () => {
    expect(() => paginate({ items: [], total: 0, page: 0, perPage: 10 })).toThrow();
  });
});
