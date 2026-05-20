/**
 * Vitest `setupFiles` entry: remove module email-template overlays
 * left on disk by other e2e files in parallel forks.
 *
 * `email-builder.e2e-spec.ts` writes `src/modules/email/templates/*.tsx`
 * during save/override tests. Under `pool: 'forks'` those files survive
 * after the writer fork exits and poison readers (e.g. hub email-preview
 * expecting the core welcome subject).
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
