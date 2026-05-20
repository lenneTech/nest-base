/**
 * Client-side table sorting for dev-portal admin list tables.
 */
import { useCallback, useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

export interface TableSortDefault<T> {
  key: keyof T | string;
  direction: SortDirection;
}

export interface UseTableSortOptions<T> {
  defaultSort?: TableSortDefault<T>;
  /** Resolve a cell value for sorting when it is not a direct property. */
  getValue?: (row: T, key: string) => unknown;
}

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

function isIsoDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * Compare two cell values for table sorting. Nullish values always sort last.
 */
export function compareTableValues(a: unknown, b: unknown): number {
  const aNull = isNullish(a);
  const bNull = isNullish(b);
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;

  if (typeof a === "boolean" && typeof b === "boolean") {
    return Number(a) - Number(b);
  }

  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() - b.getTime();
  }

  if (typeof a === "string" && typeof b === "string") {
    if (isIsoDateString(a) && isIsoDateString(b)) {
      return Date.parse(a) - Date.parse(b);
    }
    return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  }

  return String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
}

function resolveRowValue<T>(
  row: T,
  key: string,
  getValue?: (row: T, key: string) => unknown,
): unknown {
  if (getValue) return getValue(row, key);
  return (row as Record<string, unknown>)[key];
}

/**
 * Pure sort helper — useful in tests and when sorting outside React state.
 */
export function sortTableRows<T>(
  rows: readonly T[],
  sortKey: string | null,
  sortDirection: SortDirection,
  getValue?: (row: T, key: string) => unknown,
): T[] {
  if (!sortKey) return [...rows];

  const sorted = [...rows];
  sorted.sort((left, right) => {
    const cmp = compareTableValues(
      resolveRowValue(left, sortKey, getValue),
      resolveRowValue(right, sortKey, getValue),
    );
    return sortDirection === "asc" ? cmp : -cmp;
  });
  return sorted;
}

export interface UseTableSortResult<T> {
  sortedRows: T[];
  sortKey: string | null;
  sortDirection: SortDirection;
  toggleSort: (key: string) => void;
}

export function useTableSort<T>(
  rows: readonly T[],
  options?: UseTableSortOptions<T>,
): UseTableSortResult<T> {
  const defaultKey = options?.defaultSort?.key;
  const defaultDirection = options?.defaultSort?.direction ?? "asc";

  const [sortKey, setSortKey] = useState<string | null>(
    defaultKey !== undefined ? String(defaultKey) : null,
  );
  const [sortDirection, setSortDirection] = useState<SortDirection>(defaultDirection);

  const toggleSort = useCallback((key: string) => {
    setSortKey((currentKey) => {
      if (currentKey !== key) {
        setSortDirection("asc");
        return key;
      }
      setSortDirection((currentDirection) => (currentDirection === "asc" ? "desc" : "asc"));
      return key;
    });
  }, []);

  const sortedRows = useMemo(
    () => sortTableRows(rows, sortKey, sortDirection, options?.getValue),
    [rows, sortKey, sortDirection, options?.getValue],
  );

  return { sortedRows, sortKey, sortDirection, toggleSort };
}
