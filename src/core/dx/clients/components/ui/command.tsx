/**
 * shadcn-ui `Command` — vendored wrapper around `cmdk`.
 *
 * Exports the full set of primitives the CommandPalette component needs.
 * Styling follows the project's dev-portal Tailwind tokens (--surface-1,
 * --fg, --accent, etc.) so the palette integrates with the existing
 * dark-near-black shell without extra CSS.
 */
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
} from "react";

import { cn } from "../../lib/utils.js";

// ------------------------------------------------------------------ root
export const Command = forwardRef<
  ElementRef<typeof CommandPrimitive>,
  ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-md bg-surface-1 text-fg",
      className,
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

// ------------------------------------------------------------------ dialog
interface CommandDialogProps extends ComponentPropsWithoutRef<typeof CommandPrimitive> {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Full-screen overlay that wraps the Command primitive in a modal.
 * Uses the native `<dialog>` polyfill from cmdk; the overlay backdrop
 * comes from the CSS class so no Radix Dialog dependency is needed.
 */
export function CommandDialog({ open, onOpenChange, children, ...props }: CommandDialogProps) {
  // cmdk CommandDialog requires the open/onOpenChange pair.
  // We wrap it in our own portal-aware overlay to match the project's
  // dialog styles.
  if (!open) return null;

  return (
    // Overlay
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm pt-[15vh]"
      onClick={() => onOpenChange?.(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") onOpenChange?.(false);
      }}
      role="presentation"
    >
      {/* Dialog panel — stop propagation so clicks inside don't close */}
      <div
        className="relative w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface-1 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="presentation"
      >
        <CommandPrimitive
          {...props}
          className={cn(
            "flex h-full w-full flex-col overflow-hidden rounded-xl bg-surface-1 text-fg",
            props.className,
          )}
        >
          {children}
        </CommandPrimitive>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ input
export const CommandInput = forwardRef<
  ElementRef<typeof CommandPrimitive.Input>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div className="flex items-center gap-3 border-b border-line px-4 py-3">
    <Search className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden="true" />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        "flex-1 bg-transparent text-sm text-fg placeholder:text-fg-muted outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  </div>
));
CommandInput.displayName = CommandPrimitive.Input.displayName;

// ------------------------------------------------------------------ list
export const CommandList = forwardRef<
  ElementRef<typeof CommandPrimitive.List>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn("max-h-80 overflow-y-auto overflow-x-hidden", className)}
    {...props}
  />
));
CommandList.displayName = CommandPrimitive.List.displayName;

// ------------------------------------------------------------------ empty
export const CommandEmpty = forwardRef<
  ElementRef<typeof CommandPrimitive.Empty>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty ref={ref} className="py-8 text-center text-sm text-fg-muted" {...props} />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

// ------------------------------------------------------------------ group
export const CommandGroup = forwardRef<
  ElementRef<typeof CommandPrimitive.Group>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      "overflow-hidden p-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[0.65rem] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-fg-faint",
      className,
    )}
    {...props}
  />
));
CommandGroup.displayName = CommandPrimitive.Group.displayName;

// ------------------------------------------------------------------ separator
export const CommandSeparator = forwardRef<
  ElementRef<typeof CommandPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn("mx-2 my-1 h-px bg-line", className)}
    {...props}
  />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

// ------------------------------------------------------------------ item
export const CommandItem = forwardRef<
  ElementRef<typeof CommandPrimitive.Item>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center gap-2 rounded-md px-3 py-2 text-sm text-fg outline-none transition-colors",
      "data-[selected=true]:bg-accent-soft data-[selected=true]:text-accent",
      "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
      "hover:bg-surface-hover",
      className,
    )}
    {...props}
  />
));
CommandItem.displayName = CommandPrimitive.Item.displayName;

// ------------------------------------------------------------------ shortcut
export function CommandShortcut({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("ml-auto text-xs tracking-widest text-fg-faint", className)} {...props} />
  );
}
CommandShortcut.displayName = "CommandShortcut";
