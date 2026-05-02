/**
 * shadcn-ui `Toaster` (sonner) — vendored.
 *
 * The dev-portal mounts a single instance in `main.tsx`. Pages call
 * `toast(...)` from `sonner` directly to fire notifications.
 */
import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

export function Toaster({ ...props }: ToasterProps) {
  return (
    <SonnerToaster
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-surface-2 group-[.toaster]:text-fg group-[.toaster]:border-line group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-fg-muted",
          actionButton: "group-[.toast]:bg-accent group-[.toast]:text-accent-foreground",
          cancelButton: "group-[.toast]:bg-surface-3 group-[.toast]:text-fg",
        },
      }}
      {...props}
    />
  );
}
