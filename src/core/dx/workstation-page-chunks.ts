/**
 * Deterministic chunk↔page mapping for WORKSTATION-tier SPA pages.
 *
 * `scripts/build-dev-portal.ts` emits every page listed here as its own
 * named entry (`<Component>.js`, code-splitting keeps shared code in
 * anonymous `chunk-<hash>.js` files), and the `/hub/static/:filename`
 * handler refuses exactly these files when the workstation tier is not
 * servable (`isHubSurfaceAvailable("workstation")` — i.e. outside
 * `NODE_ENV=development`). The SPA router additionally registers the
 * matching routes only when `portal-access.json → workstation` is true,
 * so a deployed portal never even requests them.
 *
 * Single source of truth — build script, static handler, and the
 * mechanism story (`tests/stories/hub-workstation-chunks.story.test.ts`)
 * all import this list. Adding a workstation page = one entry here plus
 * the route in `App.tsx`'s `WORKSTATION_ROUTES`.
 *
 * Keep in lock-step with `WORKSTATION_SPA_PATH_PREFIXES`
 * (`hub-nav-planner.ts`), which classifies the SPA PATHS the same way.
 */
export const WORKSTATION_PAGE_COMPONENTS = [
  // Features: build/runtime configuration reviewed at deploy time —
  // reclassified from operational in the consolidation (phase 3).
  "FeaturesPage",
  "CoveragePage",
  "TestsPage",
  "MigrationsPage",
  "ErdPage",
  "EmailBuilderPage",
  "FileManagerPage",
  "PermissionTesterPage",
  "SearchTesterPage",
] as const;

export type WorkstationPageComponent = (typeof WORKSTATION_PAGE_COMPONENTS)[number];

/** Output filename of a workstation page entry chunk. */
export function workstationPageChunkFile(component: WorkstationPageComponent): string {
  return `${component}.js`;
}

/**
 * True when a `/hub/static/:filename` request addresses a workstation
 * page entry chunk. Exact-name match — shared `chunk-<hash>.js` files
 * and the `main.js` entry stay servable everywhere the hub is.
 */
export function isWorkstationPageChunk(filename: string): boolean {
  return (WORKSTATION_PAGE_COMPONENTS as readonly string[]).some(
    (component) => filename === `${component}.js`,
  );
}
