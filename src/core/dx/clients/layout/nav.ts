/**
 * Sidebar navigation model — single source of truth for the dev-portal
 * sidebar. All three sections (Übersicht / API & Docs / Admin) live
 * here; `App.tsx` and `AdminShell.tsx` consume the same model.
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

export const NAV_SECTIONS: readonly AdminNavSection[] = [
  {
    title: "Übersicht",
    items: [
      { id: "dev-hub", label: "Dev Hub", href: "/dev", icon: "home" },
      { id: "diagnostics", label: "Diagnostics", href: "/dev/diagnostics", icon: "heart" },
      { id: "features", label: "Features", href: "/dev/features", icon: "toggle" },
      { id: "brand", label: "Brand", href: "/dev/brand", icon: "heart" },
      { id: "coverage", label: "Coverage", href: "/dev/coverage", icon: "chart" },
      { id: "tests", label: "Tests", href: "/dev/tests", icon: "check" },
      { id: "logs", label: "Logs", href: "/dev/logs", icon: "terminal" },
      { id: "traces", label: "Traces", href: "/dev/traces", icon: "pulse" },
      { id: "queries", label: "Queries", href: "/dev/queries", icon: "database" },
      { id: "migrations", label: "Migrations", href: "/dev/migrations", icon: "database" },
      { id: "jobs", label: "Jobs", href: "/dev/jobs", icon: "layers" },
    ],
  },
  {
    title: "API & Docs",
    items: [
      { id: "scalar", label: "API Reference", href: "/api/docs", icon: "book" },
      { id: "openapi", label: "OpenAPI Spec", href: "/api/openapi", icon: "file" },
      { id: "routes", label: "Routes", href: "/dev/routes", icon: "route" },
      { id: "errors", label: "Error Codes", href: "/errors", icon: "bug" },
      { id: "erd", label: "ERD", href: "/dev/erd", icon: "network" },
      { id: "email-preview", label: "Email Preview", href: "/dev/email-preview", icon: "mail" },
      { id: "email-builder", label: "Email Builder", href: "/dev/email-builder", icon: "mail" },
      {
        id: "prisma-studio",
        label: "Prisma Studio",
        href: "http://localhost:5555",
        icon: "database",
      },
    ],
  },
  {
    title: "Admin",
    items: [
      {
        id: "permissions",
        label: "Permission Tester",
        href: "/admin/permissions/test",
        icon: "shield",
      },
      { id: "webhooks", label: "Webhook Inspector", href: "/admin/webhooks", icon: "webhook" },
      { id: "realtime", label: "Realtime Inspector", href: "/admin/realtime", icon: "radio" },
      { id: "audit", label: "Audit Browser", href: "/admin/audit", icon: "list" },
      { id: "search", label: "Search Tester", href: "/admin/search", icon: "search" },
    ],
  },
];

/**
 * Routes the React SPA renders client-side. Anything else is a real
 * navigation (server-rendered page or external URL).
 */
export const SPA_ROUTES = new Set<string>([
  "/dev",
  "/dev/diagnostics",
  "/dev/features",
  "/dev/brand",
  "/dev/coverage",
  "/dev/tests",
  "/dev/logs",
  "/dev/traces",
  "/dev/queries",
  "/dev/migrations",
  "/dev/jobs",
  "/dev/routes",
  "/dev/erd",
  "/dev/email-preview",
  "/dev/email-builder",
  "/dev/components",
  "/dev/postgrest-parse",
  "/admin/permissions/test",
  "/admin/webhooks",
  "/admin/realtime",
  "/admin/audit",
  "/admin/search",
  "/errors",
  "/api/openapi",
]);

export function isSpaRoute(href: string): boolean {
  // Anchor URLs that the SPA owns get react-router navigation;
  // everything else (Scalar UI at `/api/docs`, full URLs to Prisma
  // Studio, etc.) bypasses the router and triggers a real navigation.
  return SPA_ROUTES.has(href);
}
