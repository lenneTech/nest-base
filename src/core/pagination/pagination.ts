/**
 * Standard pagination envelope (PLAN.md §22).
 *
 * The `meta` shape is consumed by the kubb SDK generator, so the
 * contract is intentionally narrow and stable: total / page / perPage
 * / totalPages plus the `hasNext` + `hasPrev` derived booleans for
 * client convenience.
 */

export interface PaginationMeta {
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface Pagination<T> {
  items: T[];
  meta: PaginationMeta;
}

export interface PaginateInput<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export function paginate<T>(input: PaginateInput<T>): Pagination<T> {
  if (input.perPage <= 0) throw new Error("paginate: perPage must be positive");
  if (input.page <= 0) throw new Error("paginate: page must be positive");
  if (input.total < 0) throw new Error("paginate: total cannot be negative");

  const totalPages = Math.ceil(input.total / input.perPage);
  return {
    items: input.items,
    meta: {
      total: input.total,
      page: input.page,
      perPage: input.perPage,
      totalPages,
      hasNext: input.page < totalPages,
      hasPrev: input.page > 1 && totalPages > 0,
    },
  };
}
