/**
 * Scalar API-UI config (PLAN.md §32 Phase 8).
 *
 * Thin builder that produces the options bag consumed by
 * `@scalar/nestjs-api-reference`'s `apiReference()` middleware. The
 * actual mount happens in the NestJS bootstrap (a future slice that
 * also wires the OpenAPI spec endpoint); this helper just turns a
 * project-friendly input into the loose record the middleware
 * expects, plus a `mountPath` we use to register the route.
 *
 * Defaults match what every project will want — generic title, the
 * stock theme, dark-mode toggle visible. Apps override only what
 * they care about. Validation catches the two ways this gets
 * misconfigured in practice: forgetting to point at a spec at all,
 * and writing a mount path without the leading slash NestJS wants.
 */

export type ScalarTheme =
  | 'default'
  | 'alternate'
  | 'moon'
  | 'purple'
  | 'solarized'
  | 'bluePlanet'
  | 'saturn'
  | 'kepler'
  | 'mars'
  | 'deepSpace'
  | 'none';

export interface ScalarConfigInput {
  /** Path the OpenAPI document is served from (e.g. `/api/openapi.json`). */
  specUrl?: string;
  /** Inline OpenAPI document — overrides `specUrl` when both are set. */
  spec?: object;
  /** Mount path for the Scalar UI (must start with "/"). */
  mountPath?: string;
  /** Page <title> shown in the browser tab. */
  title?: string;
  /** Visual theme name. */
  theme?: ScalarTheme;
  /** Hide the dark/light toggle in the top-right corner. */
  hideDarkModeToggle?: boolean;
}

export interface ScalarConfig {
  url?: string;
  content?: object;
  theme: ScalarTheme;
  pageTitle: string;
  hideDarkModeToggle: boolean;
  mountPath: string;
}

const DEFAULT_MOUNT_PATH = '/api/docs';
const DEFAULT_THEME: ScalarTheme = 'default';
const DEFAULT_TITLE = 'API Reference';

export class ScalarSpecRequiredError extends Error {
  constructor() {
    super('scalar-config: either `specUrl` or `spec` is required');
    this.name = 'ScalarSpecRequiredError';
  }
}

export function buildScalarConfig(input: ScalarConfigInput): ScalarConfig {
  if (!input.specUrl && !input.spec) {
    throw new ScalarSpecRequiredError();
  }
  const mountPath = input.mountPath ?? DEFAULT_MOUNT_PATH;
  if (!mountPath || !mountPath.startsWith('/')) {
    throw new Error(`scalar-config: mountPath must be a non-empty path starting with "/" (got "${mountPath}")`);
  }
  const config: ScalarConfig = {
    theme: input.theme ?? DEFAULT_THEME,
    pageTitle: input.title ?? DEFAULT_TITLE,
    hideDarkModeToggle: input.hideDarkModeToggle ?? false,
    mountPath,
  };
  if (input.spec) {
    config.content = input.spec;
  } else if (input.specUrl) {
    config.url = input.specUrl;
  }
  return config;
}
