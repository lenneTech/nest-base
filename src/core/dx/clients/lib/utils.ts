/**
 * `cn()` — the standard shadcn-ui classname helper.
 *
 * Combines `clsx` (conditional join) with `tailwind-merge` (later
 * utility wins). Every shadcn component imports this; we vendor it
 * once here so the dev-portal SPA stays self-contained.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
