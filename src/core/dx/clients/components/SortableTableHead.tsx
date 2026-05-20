/**
 * Clickable table header cell with sort direction indicator.
 */
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../lib/utils.js";
import type { SortDirection } from "../lib/use-table-sort.js";
import { TableHead } from "./ui/table.js";

export interface SortableTableHeadProps {
  label: string;
  sortKey: string;
  activeSortKey: string | null;
  sortDirection: SortDirection;
  onSort: (key: string) => void;
  className?: string;
  align?: "left" | "right" | "center";
}

export function SortableTableHead({
  label,
  sortKey,
  activeSortKey,
  sortDirection,
  onSort,
  className,
  align = "left",
}: SortableTableHeadProps): ReactNode {
  const isActive = activeSortKey === sortKey;
  const ariaSort = isActive ? (sortDirection === "asc" ? "ascending" : "descending") : "none";

  return (
    <TableHead
      className={cn(
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
      aria-sort={ariaSort}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex w-full cursor-pointer items-center gap-1 rounded-sm transition-colors",
          "hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
          align === "right" && "justify-end",
          align === "center" && "justify-center",
          isActive ? "text-fg" : "text-fg-dim",
        )}
      >
        <span>{label}</span>
        {isActive ? (
          sortDirection === "asc" ? (
            <ArrowUp className="size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <ArrowDown className="size-3.5 shrink-0" aria-hidden="true" />
          )
        ) : (
          <ArrowUpDown className="size-3.5 shrink-0 opacity-40" aria-hidden="true" />
        )}
      </button>
    </TableHead>
  );
}
