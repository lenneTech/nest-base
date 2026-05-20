import { resolve } from "node:path";

/**
 * Single source of truth for the *module-overlay* email-templates
 * directory — the place where project-specific `.tsx` templates live
 * and where `/hub/email-builder/save` writes generated overlays.
 *
 * Why this exists (test-isolation):
 *   Vitest runs e2e files in parallel forks (`pool: 'forks'`). The
 *   email-builder save endpoint writes into the SHARED on-disk path
 *   `src/modules/email/templates/`; a concurrent fork rendering
 *   `/hub/email-preview` reads the same dir and sees the writer's
 *   overlay (e.g. "Custom welcome") instead of the core template
 *   ("Welcome to nest-server"). Making the dir env-overridable lets
 *   the writer test point at a private temp dir, removing the race at
 *   its root rather than racing a best-effort cleanup.
 *
 * Reader and writer MUST resolve through the same helper so they
 * always agree on the active dir. The default is unchanged, so
 * production behaviour and existing on-disk overlays are untouched.
 *
 * Pure planner: takes `projectRoot` + `env` explicitly (no implicit
 * `process.cwd()` / `process.env` reads) so it's trivially testable
 * and matches the repo's planner/runner split.
 */

/** Env var that overrides the module-overlay templates directory. */
export const EMAIL_MODULE_TEMPLATES_DIR_ENV = "EMAIL_MODULE_TEMPLATES_DIR";

/** Default module-overlay templates dir, relative to the project root. */
export const DEFAULT_MODULE_TEMPLATES_REL = "src/modules/email/templates";

/** Core templates dir, relative to the project root. */
export const CORE_EMAIL_REL = "src/core/email";

/**
 * Relative import prefix from a generated overlay file to `src/core/email`.
 *
 * A file at `src/modules/email/templates/<slug>.tsx` reaches
 * `src/core/email` via three `..` hops (templates → email → modules →
 * src), so `../../../core/email` is correct *only* at the canonical
 * depth. When the dir is overridden the prefix becomes absolute (see
 * `resolveModuleTemplateCoreImportPrefix`).
 */
export const MODULE_TEMPLATE_CORE_IMPORT_PREFIX_RELATIVE = "../../../core/email";

export interface ResolveModuleTemplatesDirInput {
  /** Project root — usually `process.cwd()`. */
  projectRoot: string;
  /** Environment bag — usually `process.env`. */
  env: Record<string, string | undefined>;
}

/**
 * Resolve the active module-overlay templates directory.
 *
 * - `EMAIL_MODULE_TEMPLATES_DIR` set + non-empty → that path,
 *   `resolve()`d to absolute (relative overrides anchor on the cwd).
 * - otherwise → `<projectRoot>/src/modules/email/templates`.
 */
export function resolveModuleTemplatesDir(input: ResolveModuleTemplatesDirInput): string {
  const override = input.env[EMAIL_MODULE_TEMPLATES_DIR_ENV];
  if (override !== undefined && override.length > 0) {
    return resolve(override);
  }
  return resolve(input.projectRoot, DEFAULT_MODULE_TEMPLATES_REL);
}

/**
 * Resolve the import prefix the codegen should use for core imports
 * (`Barebone`, blocks, `BrandConfig`) inside a generated overlay file.
 *
 * The generated file's relative imports resolve against the file's
 * actual on-disk location at import time. At the canonical depth the
 * relative prefix is correct and keeps codegen output byte-identical
 * (round-trip tests depend on it). When the dir is overridden the file
 * no longer sits at that depth, so we emit an ABSOLUTE path to
 * `src/core/email`, which Bun resolves regardless of where the overlay
 * lives.
 */
export function resolveModuleTemplateCoreImportPrefix(
  input: ResolveModuleTemplatesDirInput,
): string {
  const override = input.env[EMAIL_MODULE_TEMPLATES_DIR_ENV];
  if (override !== undefined && override.length > 0) {
    return resolve(input.projectRoot, CORE_EMAIL_REL);
  }
  return MODULE_TEMPLATE_CORE_IMPORT_PREFIX_RELATIVE;
}
