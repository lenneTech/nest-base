/**
 * shadcn-ui `Badge` — vendored. Adds an `accent` and status variants
 * the dev-portal needs (ok / warn / err / info) on top of the shadcn
 * defaults.
 */
import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/utils.js";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-accent-soft text-accent",
        secondary: "border-line-strong bg-surface-3 text-fg",
        destructive: "border-transparent bg-destructive/15 text-destructive",
        outline: "border-line text-fg",
        ok: "border-transparent bg-ok/15 text-ok",
        warn: "border-transparent bg-warn/15 text-warn",
        err: "border-transparent bg-err/15 text-err",
        info: "border-transparent bg-accent-soft text-accent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
