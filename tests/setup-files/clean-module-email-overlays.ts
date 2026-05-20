/**
 * Vitest `setupFiles` entry: remove module email-template overlays
 * left on disk in `src/modules/email/templates/`.
 *
 * Belt-and-suspenders. The actual fix for the cross-fork race is in
 * `email-builder.e2e-spec.ts`, which now redirects every overlay write
 * to a private temp dir via `EMAIL_MODULE_TEMPLATES_DIR` and never
 * touches `src/modules/email/templates/`. This worker-start cleaner
 * stays as a safety net for any stray overlay a future writer (or a
 * developer running the save endpoint manually) might leave behind —
 * it only runs at worker START, so it can never prevent a concurrent
 * writer on its own.
 */
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const SLUGS = [
  "welcome",
  "password-reset",
  "email-verification",
  "e2e-builder-test",
  "e2e-builder-traversal",
] as const;

export function cleanModuleEmailTemplateOverlays(root = process.cwd()): void {
  for (const slug of SLUGS) {
    const path = resolve(root, `src/modules/email/templates/${slug}.tsx`);
    if (existsSync(path)) rmSync(path);
  }
}

cleanModuleEmailTemplateOverlays();
