/**
 * Sidebar navigation model — single source of truth for the dev-portal
 * sidebar. All four sections (Übersicht / Laufzeit / API & Docs / Admin)
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
}

export interface AdminNavSection {
  title: string;
  items: AdminNavItem[];
}

/** Sidebar section title for tenant-admin CRUD / inspectors. */
export const ADMIN_NAV_SECTION_TITLE = "Admin";

export const NAV_SECTIONS: readonly AdminNavSection[] = [
  {
    title: "Übersicht",
    items: [
      { id: "dev-hub", label: "Hub", href: "/hub", icon: "home" },
      { id: "diagnostics", label: "Diagnostics", href: "/hub/diagnostics", icon: "activity" },
      { id: "features", label: "Features", href: "/hub/features", icon: "toggle" },
      { id: "brand", label: "Brand", href: "/hub/brand", icon: "palette" },
      { id: "coverage", label: "Coverage", href: "/hub/coverage", icon: "chart" },
      { id: "tests", label: "Tests", href: "/hub/tests", icon: "check" },
    ],
  },
  {
    title: "Laufzeit",
    items: [
      { id: "logs", label: "Logs", href: "/hub/logs", icon: "terminal" },
      { id: "traces", label: "Traces", href: "/hub/traces", icon: "pulse" },
      { id: "queries", label: "Queries", href: "/hub/queries", icon: "database" },
      { id: "migrations", label: "Migrations", href: "/hub/migrations", icon: "table" },
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
      { id: "erd", label: "ERD", href: "/hub/erd", icon: "network" },
      { id: "email-preview", label: "Email Preview", href: "/hub/email-preview", icon: "eye" },
      { id: "email-builder", label: "Email Builder", href: "/hub/email-builder", icon: "pen" },
      {
        id: "prisma-studio",
        label: "Prisma Studio",
        href: "http://localhost:5555",
        icon: "external-link",
      },
    ],
  },
  {
    title: ADMIN_NAV_SECTION_TITLE,
    items: [
      { id: "users", label: "Benutzer", href: "/admin/users", icon: "users" },
      { id: "tenants", label: "Mandanten", href: "/admin/tenants", icon: "building" },
      { id: "sessions", label: "Sessions", href: "/admin/sessions", icon: "key" },
      { id: "roles", label: "Roles", href: "/admin/roles", icon: "shield" },
      { id: "policies", label: "Policies", href: "/admin/policies", icon: "scale" },
      { id: "permissions-crud", label: "Permissions", href: "/admin/permissions", icon: "lock" },
      {
        id: "permissions",
        label: "Permission Tester",
        href: "/admin/permissions/test",
        icon: "clipboard",
      },
      { id: "rate-limits", label: "Rate-Limits", href: "/admin/rate-limits", icon: "gauge" },
      { id: "webhooks", label: "Webhook Inspector", href: "/admin/webhooks", icon: "webhook" },
      { id: "realtime", label: "Realtime Inspector", href: "/admin/realtime", icon: "radio" },
      { id: "audit", label: "Audit Browser", href: "/admin/audit", icon: "list" },
      { id: "search", label: "Search Tester", href: "/admin/search", icon: "search" },
      { id: "files", label: "File Manager", href: "/hub/files", icon: "file" },
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
  "/hub/email-preview",
  "/hub/email-builder",
  "/hub/components",
  "/hub/postgrest-parse",
  "/hub/json",
  "/hub/files",
  "/admin/roles",
  "/admin/policies",
  "/admin/permissions",
  "/admin/permissions/test",
  "/admin/users",
  "/admin/tenants",
  "/admin/sessions",
  "/admin/webhooks",
  "/admin/realtime",
  "/admin/audit",
  "/admin/search",
  "/admin/rate-limits",
  "/errors",
  "/openapi",
]);

/** Hide Admin nav when the signed-in operator lacks tenant-admin CASL subjects. */
export function navSectionsForPortalAccess(tenantAdmin: boolean): readonly AdminNavSection[] {
  return NAV_SECTIONS.filter((section) => section.title !== ADMIN_NAV_SECTION_TITLE || tenantAdmin);
}

export function isSpaRoute(href: string): boolean {
  // Anchor URLs that the SPA owns get react-router navigation;
  // everything else (Scalar UI at `/api/docs`, full URLs to Prisma
  // Studio, etc.) bypasses the router and triggers a real navigation.
  return SPA_ROUTES.has(href);
}
