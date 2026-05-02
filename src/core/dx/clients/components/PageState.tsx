/**
 * Tiny helpers for the standard "loading / error / empty" states every
 * page emits. Centralised so the visual treatment stays consistent.
 */
import type { ReactNode } from "react";

import { cn } from "../lib/utils.js";

interface BaseProps {
  className?: string;
  children?: ReactNode;
}

/** Card-shaped placeholder used while a query is in flight. */
export function PageLoading({ className, children }: BaseProps) {
  return (
    <div
      className={cn(
        "flex min-h-[6rem] items-center justify-center rounded-lg border border-dashed border-line bg-surface-1/40 p-6 text-sm text-fg-muted",
        className,
      )}
    >
      {children ?? "Loading…"}
    </div>
  );
}

/** Card-shaped placeholder shown when an endpoint failed. */
export function PageError({ className, children }: BaseProps) {
  return (
    <div
      className={cn(
        "flex min-h-[6rem] items-center justify-center rounded-lg border border-err/40 bg-err/10 p-6 text-sm text-err",
        className,
      )}
    >
      {children ?? "Failed to load."}
    </div>
  );
}

/** Card-shaped placeholder shown when no rows / data exist. */
export function PageEmpty({ className, children }: BaseProps) {
  return (
    <div
      className={cn(
        "flex min-h-[6rem] items-center justify-center rounded-lg border border-dashed border-line bg-surface-1/40 p-6 text-sm text-fg-muted",
        className,
      )}
    >
      {children ?? "Nothing to show."}
    </div>
  );
}

/** A tile with a label / value used across the dashboard hero rows. */
export function StatTile({
  label,
  value,
  hint,
  tone = "default",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "ok" | "warn" | "err" | "info";
  className?: string;
}) {
  const valueTone =
    tone === "ok"
      ? "text-ok"
      : tone === "warn"
        ? "text-warn"
        : tone === "err"
          ? "text-err"
          : tone === "info"
            ? "text-accent"
            : "text-fg";
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface-1 p-4 transition-colors hover:border-line-strong",
        className,
      )}
    >
      <div className="text-[0.65rem] font-semibold uppercase tracking-widest text-fg-faint">
        {label}
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tabular-nums tracking-tight", valueTone)}>
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-fg-muted">{hint}</div> : null}
    </div>
  );
}
