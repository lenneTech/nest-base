/**
 * shadcn-ui `Table` family — vendored.
 */
import {
  forwardRef,
  type HTMLAttributes,
  type Ref,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
  type UIEventHandler,
} from "react";

import { cn } from "../../lib/utils.js";

/** Scrollport shared by every hub table — sticky headers stick to this box. */
export const TABLE_SCROLL_CONTAINER_CLASS =
  "relative w-full max-h-[65dvh] min-h-56 overflow-auto rounded-lg border border-line";

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  containerClassName?: string;
  containerRef?: Ref<HTMLDivElement>;
  onContainerScroll?: UIEventHandler<HTMLDivElement>;
}

export const Table = forwardRef<HTMLTableElement, TableProps>(
  ({ className, containerClassName, containerRef, onContainerScroll, ...props }, ref) => (
    <div
      ref={containerRef}
      onScroll={onContainerScroll}
      className={cn(TABLE_SCROLL_CONTAINER_CLASS, containerClassName)}
    >
      <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  ),
);
Table.displayName = "Table";

export const TableHeader = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn("[&_tr]:border-b border-line bg-surface-2", className)}
    {...props}
  />
));
TableHeader.displayName = "TableHeader";

export const TableBody = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

export const TableFooter = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t border-line bg-surface-2 font-medium [&>tr]:last:border-b-0",
      className,
    )}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

export const TableRow = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b border-line transition-colors hover:bg-surface-hover/50 data-[state=selected]:bg-surface-hover",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

export const TableHead = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        "sticky top-0 z-10 bg-surface-2 h-9 px-3 text-left align-middle text-[0.7rem] font-semibold uppercase tracking-wider text-fg-dim shadow-[inset_0_-1px_0_0_var(--line)] [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = "TableHead";

export const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn("p-3 align-middle [&:has([role=checkbox])]:pr-0", className)}
      {...props}
    />
  ),
);
TableCell.displayName = "TableCell";

export const TableCaption = forwardRef<
  HTMLTableCaptionElement,
  HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn("mt-4 text-sm text-fg-muted", className)} {...props} />
));
TableCaption.displayName = "TableCaption";
