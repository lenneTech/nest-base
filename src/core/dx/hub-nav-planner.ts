/**
 * Pure planner — Hub sidebar + SPA route visibility from feature flags.
 *
 * Keeps `nav.ts` (client), `hub.controller.ts` (palette search), and
 * `HubLandingPage` quick-links aligned on which surfaces require which
 * `FeaturesSchema` toggles.
 */
import type { HubPortalNavFeatures } from "../hub/hub-portal-access.js";
import type { Features, ToggleableFeatureKey } from "../features/features.js";
import { isFeatureActive } from "./feature-catalog.js";
import type { PalettePageEntry } from "./palette-search-planner.js";

/**
 * Always-on hub nav (no feature flag): hub, diagnostics, features, brand,
 * coverage, tests, logs, queries, migrations, traces, scalar, openapi,
 * routes, errors, erd, prisma-studio, users, sessions, roles, policies,
 * permissions, permission tester.
 */

/** SPA paths gated when a toggleable feature is off (prefix match). */
export const SPA_ROUTE_FEATURE_REQUIREMENTS: ReadonlyArray<{
  pathPrefix: string;
  feature: ToggleableFeatureKey;
}> = [
  { pathPrefix: "/hub/admin/tenants", feature: "multiTenancy" },
  { pathPrefix: "/hub/admin/webhooks", feature: "webhooks" },
  { pathPrefix: "/hub/admin/realtime", feature: "realtime" },
  { pathPrefix: "/hub/admin/audit", feature: "audit" },
  { pathPrefix: "/hub/admin/search", feature: "search" },
  { pathPrefix: "/hub/admin/rate-limits", feature: "rateLimit" },
  { pathPrefix: "/hub/files", feature: "files" },
  { pathPrefix: "/hub/jobs", feature: "jobs" },
  { pathPrefix: "/hub/cron", feature: "jobs" },
  { pathPrefix: "/hub/email-outbox", feature: "email" },
  { pathPrefix: "/hub/emails", feature: "email" },
  { pathPrefix: "/hub/email-preview", feature: "email" },
  { pathPrefix: "/hub/email-builder", feature: "email" },
];

/** Nav item ids gated when a toggleable feature is off. */
export const NAV_ITEM_FEATURE_REQUIREMENTS: Readonly<
  Partial<Record<string, ToggleableFeatureKey>>
> = {
  tenants: "multiTenancy",
  webhooks: "webhooks",
  realtime: "realtime",
  audit: "audit",
  search: "search",
  files: "files",
  "rate-limits": "rateLimit",
  jobs: "jobs",
  cron: "jobs",
  "email-outbox": "email",
  emails: "email",
};

const NAV_SNAPSHOT_KEYS: ReadonlyArray<keyof HubPortalNavFeatures> = [
  "multiTenancy",
  "files",
  "email",
  "webhooks",
  "search",
  "realtime",
  "audit",
  "rateLimit",
  "jobs",
];

function isFeatureEnabledInNavSnapshot(
  snapshot: HubPortalNavFeatures,
  key: ToggleableFeatureKey,
): boolean {
  if ((NAV_SNAPSHOT_KEYS as readonly string[]).includes(key)) {
    return snapshot[key as keyof HubPortalNavFeatures];
  }
  return true;
}

export function isNavItemVisibleForNavSnapshot(
  itemId: string,
  snapshot: HubPortalNavFeatures,
): boolean {
  const key = NAV_ITEM_FEATURE_REQUIREMENTS[itemId];
  if (!key) return true;
  return isFeatureEnabledInNavSnapshot(snapshot, key);
}

export function isSpaPathAllowedByNavSnapshot(
  pathname: string,
  snapshot: HubPortalNavFeatures,
): boolean {
  for (const { pathPrefix, feature } of SPA_ROUTE_FEATURE_REQUIREMENTS) {
    if (pathname === pathPrefix || pathname.startsWith(`${pathPrefix}/`)) {
      return isFeatureEnabledInNavSnapshot(snapshot, feature);
    }
  }
  return true;
}

export function isSpaPathAllowedByFeatures(pathname: string, features: Features): boolean {
  return isSpaPathAllowedByNavSnapshot(pathname, buildHubNavFeatureSnapshot(features));
}

/**
 * SPA paths whose DATA endpoints are workstation-tier (see
 * `hub-surface-policy.ts` — dev-only forever). Outside development the
 * server 404s their JSON, so nav, quick links, the palette, and the
 * client route gate hide them when `portal-access.json` says
 * `workstation: false`. Page-shell tiers do not matter here — this list
 * classifies what the PAGE needs to function.
 */
export const WORKSTATION_SPA_PATH_PREFIXES: readonly string[] = [
  "/hub/coverage",
  "/hub/tests",
  "/hub/migrations",
  "/hub/erd",
  "/hub/emails",
  "/hub/email-preview",
  "/hub/email-builder",
  "/hub/files",
  "/hub/admin/permissions/test",
  "/hub/admin/search",
];

/** Prefix match, same semantics as `SPA_ROUTE_FEATURE_REQUIREMENTS`. */
export function isSpaPathWorkstationOnly(pathname: string): boolean {
  return WORKSTATION_SPA_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Hub landing quick-links: SPA paths respect flags; `/api/docs` and `/errors` stay visible. */
export function isHubQuickLinkVisible(href: string, snapshot: HubPortalNavFeatures): boolean {
  const path = href.split("?")[0] ?? href;
  if (path.startsWith("/hub")) {
    return isSpaPathAllowedByNavSnapshot(path, snapshot);
  }
  return true;
}

export function filterPalettePagesForNavSnapshot(
  pages: readonly PalettePageEntry[],
  snapshot: HubPortalNavFeatures,
): PalettePageEntry[] {
  return pages.filter((page) => isSpaPathAllowedByNavSnapshot(page.href, snapshot));
}

/** Fallback when `portal-access.json` predates extended `features` shape. */
export const LEGACY_HUB_NAV_FEATURES_FALLBACK: HubPortalNavFeatures = {
  multiTenancy: true,
  files: true,
  email: true,
  webhooks: true,
  search: true,
  realtime: true,
  audit: true,
  rateLimit: true,
  jobs: true,
};
/** Minimal feature snapshot for `GET /hub/portal-access.json`. */
export function buildHubNavFeatureSnapshot(features: Features): HubPortalNavFeatures {
  return {
    multiTenancy: isFeatureActive(features, "multiTenancy"),
    files: isFeatureActive(features, "files"),
    email: isFeatureActive(features, "email"),
    webhooks: isFeatureActive(features, "webhooks"),
    search: isFeatureActive(features, "search"),
    realtime: isFeatureActive(features, "realtime"),
    audit: isFeatureActive(features, "audit"),
    rateLimit: isFeatureActive(features, "rateLimit"),
    jobs: isFeatureActive(features, "jobs"),
  };
}
