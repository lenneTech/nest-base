import type { HubPortalNavFeatures } from "../../../hub/hub-portal-access.js";
import { isNavItemVisibleForNavSnapshot } from "../../hub-nav-planner.js";

/**
 * Sidebar navigation model — single source of truth for the dev-portal
 * sidebar. All four sections (Overview / Runtime / API & Docs / Admin)
 * live here; `App.tsx` and `AdminShell.tsx` consume the same model.
 *
 * `id` matches `currentNav` on each page so the active-state highlight
 * works identically. Routes that the SPA owns are listed in
 * `SPA_ROUTES` and clicking them stays inside react-router; everything
 * else (e.g. `http://localhost:5555` for Prisma Studio, `/api/docs`
 * for Scalar UI, `/health/*`) does a real navigation via plain
 * `<a href>`.
 */

export interface AdminNavItem {
  id: string;
  label: string;
  href: string;
  /** key into `ICONS` from `./icons.tsx`. */
  icon: string;
  /**
   * `"workstation"` — the page's data lives on the developer's
   * workstation (checkout files, .env, localhost tools), so its data
   * endpoints are dev-only forever (see `hub-surface-policy.ts`).
   * Hidden when `portal-access.json` reports `workstation: false`.
   */
  tier?: "workstation";
}

export interface AdminNavSection {
  title: string;
  items: AdminNavItem[];
}

/** Sidebar section title for tenant-admin CRUD / inspectors. */
export const ADMIN_NAV_SECTION_TITLE = "Admin";

export const NAV_SECTIONS: readonly AdminNavSection[] = [
  {
    title: "Overview",
    items: [
      { id: "hub", label: "Hub", href: "/hub", icon: "home" },
      { id: "diagnostics", label: "Diagnostics", href: "/hub/diagnostics", icon: "activity" },
      { id: "features", label: "Features", href: "/hub/features", icon: "toggle" },
      { id: "brand", label: "Brand", href: "/hub/brand", icon: "palette" },
      {
        id: "coverage",
        label: "Coverage",
        href: "/hub/coverage",
        icon: "chart",
        tier: "workstation",
      },
      { id: "tests", label: "Tests", href: "/hub/tests", icon: "check", tier: "workstation" },
    ],
  },
  {
    title: "Runtime",
    items: [
      { id: "logs", label: "Logs", href: "/hub/logs", icon: "terminal" },
      { id: "traces", label: "Traces", href: "/hub/traces", icon: "pulse" },
      { id: "queries", label: "Queries", href: "/hub/queries", icon: "database" },
      {
        id: "migrations",
        label: "Migrations",
        href: "/hub/migrations",
        icon: "table",
        tier: "workstation",
      },
      { id: "jobs", label: "Jobs", href: "/hub/jobs", icon: "layers" },
      { id: "cron", label: "Cron", href: "/hub/cron", icon: "clock" },
      { id: "email-outbox", label: "Email Outbox", href: "/hub/email-outbox", icon: "inbox" },
    ],
  },
  {
    title: "API & Docs",
    items: [
      { id: "scalar", label: "API Reference", href: "/api/docs", icon: "book" },
      { id: "openapi", label: "OpenAPI Spec", href: "/openapi", icon: "file" },
      { id: "routes", label: "Routes", href: "/hub/routes", icon: "route" },
      { id: "errors", label: "Error Codes", href: "/errors", icon: "bug" },
      { id: "erd", label: "ERD", href: "/hub/erd", icon: "network", tier: "workstation" },
      { id: "emails", label: "Emails", href: "/hub/emails", icon: "mail", tier: "workstation" },
      {
        id: "prisma-studio",
        label: "Prisma Studio",
        // The dev-runner's Prisma Studio on the developer's own machine —
        // a dead link from any deployed portal, hence workstation tier.
        href: "http://localhost:5555",
        icon: "external-link",
        tier: "workstation",
      },
    ],
  },
  {
    title: ADMIN_NAV_SECTION_TITLE,
    items: [
      { id: "users", label: "Users", href: "/hub/admin/users", icon: "users" },
      { id: "tenants", label: "Tenants", href: "/hub/admin/tenants", icon: "building" },
      { id: "sessions", label: "Sessions", href: "/hub/admin/sessions", icon: "key" },
      { id: "roles", label: "Roles", href: "/hub/admin/roles", icon: "shield" },
      { id: "policies", label: "Policies", href: "/hub/admin/policies", icon: "scale" },
      {
        id: "permissions-crud",
        label: "Permissions",
        href: "/hub/admin/permissions",
        icon: "lock",
      },
      {
        id: "permissions",
        label: "Permission Tester",
        href: "/hub/admin/permissions/test",
        icon: "clipboard",
        tier: "workstation",
      },
      { id: "rate-limits", label: "Rate Limits", href: "/hub/admin/rate-limits", icon: "gauge" },
      { id: "webhooks", label: "Webhook Inspector", href: "/hub/admin/webhooks", icon: "webhook" },
      { id: "realtime", label: "Realtime Inspector", href: "/hub/admin/realtime", icon: "radio" },
      { id: "audit", label: "Audit Browser", href: "/hub/admin/audit", icon: "list" },
      {
        id: "search",
        label: "Search Tester",
        href: "/hub/admin/search",
        icon: "search",
        tier: "workstation",
      },
      { id: "files", label: "File Manager", href: "/hub/files", icon: "file", tier: "workstation" },
    ],
  },
];

/**
 * Routes the React SPA renders client-side. Anything else is a real
 * navigation (server-rendered page or external URL).
 */
export const SPA_ROUTES = new Set<string>([
  "/hub",
  "/hub/diagnostics",
  "/hub/features",
  "/hub/brand",
  "/hub/coverage",
  "/hub/tests",
  "/hub/logs",
  "/hub/traces",
  "/hub/queries",
  "/hub/migrations",
  "/hub/jobs",
  "/hub/cron",
  "/hub/email-outbox",
  "/hub/routes",
  "/hub/erd",
  "/hub/emails",
  "/hub/postgrest-parse",
  "/hub/json",
  "/hub/files",
  "/hub/admin/roles",
  "/hub/admin/policies",
  "/hub/admin/permissions",
  "/hub/admin/permissions/test",
  "/hub/admin/users",
  "/hub/admin/tenants",
  "/hub/admin/sessions",
  "/hub/admin/webhooks",
  "/hub/admin/realtime",
  "/hub/admin/audit",
  "/hub/admin/search",
  "/hub/admin/rate-limits",
  "/errors",
  "/openapi",
]);

export interface PortalNavAccessInput {
  hub: boolean;
  tenantAdmin: boolean;
  navFeatures: HubPortalNavFeatures;
  /** `portal-access.json → workstation` — false hides workstation-tier entries. */
  workstation: boolean;
}

/** Sidebar sections visible for the signed-in operator and active feature flags. */
export function navSectionsForPortalAccess(
  access: PortalNavAccessInput,
): readonly AdminNavSection[] {
  let sections: readonly AdminNavSection[];
  if (!access.hub && access.tenantAdmin) {
    sections = NAV_SECTIONS.filter((section) => section.title === ADMIN_NAV_SECTION_TITLE);
  } else if (!access.tenantAdmin) {
    sections = NAV_SECTIONS.filter((section) => section.title !== ADMIN_NAV_SECTION_TITLE);
  } else {
    sections = NAV_SECTIONS;
  }
  const filtered = filterNavSectionsForSnapshot(sections, access.navFeatures);
  if (access.workstation) {
    // Development: byte-identical nav — the tier tags stay invisible.
    return filtered;
  }
  return filtered
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.tier !== "workstation"),
    }))
    .filter((section) => section.items.length > 0);
}

export function isSpaRoute(href: string): boolean {
  return SPA_ROUTES.has(href);
}

export function filterNavSectionsForSnapshot(
  sections: readonly AdminNavSection[],
  snapshot: HubPortalNavFeatures,
): AdminNavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => isNavItemVisibleForNavSnapshot(item.id, snapshot)),
    }))
    .filter((section) => section.items.length > 0);
}
