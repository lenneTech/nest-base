/**
 * shadcn-ui `Textarea` — vendored.
 */
import { forwardRef, type TextareaHTMLAttributes } from "react";

import { cn } from "../../lib/utils.js";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-16 w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm shadow-sm placeholder:text-fg-faint focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";
