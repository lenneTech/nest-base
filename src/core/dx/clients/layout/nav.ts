/**
 * Sidebar navigation model — verbatim port of `defaultAdminNav()` in
 * `src/core/dx/admin-layout.ts`. The two surfaces share the same nav
 * order, same labels, same destination URLs so a user clicking "Dev
 * Hub" from a server-rendered admin page lands in the React SPA at
 * the same logical route.
 *
 * `id` matches `currentNav` on each page so the active-state highlight
 * works identically. Routes that the React SPA owns end up as
 * relative `/dev/*` paths (handled by react-router); routes still on
 * the server (`/admin/*`, `/api/*`, `/errors`, `http://localhost:5555`
 * for Prisma Studio) are emitted as plain `<a href>` so the browser
 * does a normal navigation.
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
      { id: "coverage", label: "Coverage", href: "/dev/coverage", icon: "chart" },
      { id: "tests", label: "Tests", href: "/dev/tests", icon: "check" },
      { id: "logs", label: "Logs", href: "/dev/logs", icon: "terminal" },
      { id: "traces", label: "Traces", href: "/dev/traces", icon: "pulse" },
      { id: "queries", label: "Queries", href: "/dev/queries", icon: "database" },
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
  "/dev/coverage",
  "/dev/tests",
  "/dev/logs",
  "/dev/traces",
  "/dev/queries",
  "/dev/routes",
  "/dev/erd",
  "/dev/email-preview",
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
