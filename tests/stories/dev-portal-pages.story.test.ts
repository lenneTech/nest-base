import { describe, expect, it } from "vitest";

/**
 * Story · Dev-Portal SPA route + nav contract.
 *
 * The React `App.tsx` and the sidebar nav (`clients/layout/nav.ts`)
 * must stay in lock-step:
 *   - every SPA route is owned by a page chunk in `App.tsx`
 *   - every SPA-owned `/hub/*` URL appears in the sidebar so users
 *     can navigate to it without typing the URL
 *   - every `*.json` endpoint the React pages consume actually exists
 *     on the server (`hub.controller.ts` declares it)
 *
 * Pure file-text assertions — no NestJS bootstrap, no React mount.
 * Locks the cross-tier contract that makes the visual fidelity port
 * work end-to-end.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

function read(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), "utf8");
}

const APP_TSX = read("src/core/dx/clients/App.tsx");
const NAV_TS = read("src/core/dx/clients/layout/nav.ts");
const CONTROLLER = read("src/core/dx/hub.controller.ts");
const ADMIN_SPA_CONTROLLER = read("src/core/dx/admin-spa.controller.ts");
const GLOBALS_CSS = read("src/core/dx/clients/styles/globals.css");
const TOKENS_CSS = read("src/core/dx/clients/styles/tokens.css");
const ADMIN_SHELL = read("src/core/dx/clients/layout/AdminShell.tsx");
const ADMIN_PORTAL_LAYOUT = read("src/core/dx/clients/layout/AdminPortalLayout.tsx");
const ICONS_TSX = read("src/core/dx/clients/layout/icons.tsx");
const TESTS_PAGE = read("src/core/dx/clients/pages/TestsPage.tsx");
const COVERAGE_PAGE = read("src/core/dx/clients/pages/CoveragePage.tsx");
const COPY_BUTTON = read("src/core/dx/clients/components/CopyButton.tsx");
const PERMISSIONS_ADMIN_PAGE = read("src/core/dx/clients/pages/PermissionsAdminPage.tsx");
const PERMISSION_TESTER_PAGE = read("src/core/dx/clients/pages/PermissionTesterPage.tsx");
const FEATURES_PAGE = read("src/core/dx/clients/pages/FeaturesPage.tsx");
const AUDIT_BROWSER_PAGE = read("src/core/dx/clients/pages/AuditBrowserPage.tsx");
const API_TS = read("src/core/dx/clients/lib/api.ts");
const HUB_LOGIN_PAGE = read("src/core/dx/clients/pages/HubLoginPage.tsx");

describe("Story · Dev-Portal SPA route + nav contract", () => {
  describe("admin fetch sends session cookies", () => {
    it("fetchJson uses credentials include for Better-Auth session", () => {
      expect(API_TS).toContain('credentials: "include"');
      expect(API_TS).toContain("adminFetch");
    });

    it("signInWithEmail posts to Better-Auth with credentials include", () => {
      expect(API_TS).toContain('fetch("/api/auth/sign-in/email"');
      expect(API_TS).toContain("signInWithEmail");
    });
  });

  describe("Hub login page", () => {
    it("HubLoginPage signs in via Better-Auth and navigates to /hub", () => {
      expect(HUB_LOGIN_PAGE).toContain("signInWithEmail");
      expect(HUB_LOGIN_PAGE).toContain("resolveOperatorLandingPath");
      expect(HUB_LOGIN_PAGE).toContain('invalidateQueries({ queryKey: ["hub", "portal-access"]');
      expect(HUB_LOGIN_PAGE).toContain("/hub/portal-access.json");
      expect(HUB_LOGIN_PAGE).toContain("Remember email on this device");
      expect(HUB_LOGIN_PAGE).toContain("persistLoginPrefs");
    });

    it("HubLoginPage uses animated hub-login backdrop and card chrome", () => {
      expect(HUB_LOGIN_PAGE).toContain('import "../styles/hub-login.css"');
      expect(HUB_LOGIN_PAGE).toContain("hub-login-scene");
      expect(HUB_LOGIN_PAGE).toContain("hub-login-backdrop");
      expect(HUB_LOGIN_PAGE).toContain("hub-login-backdrop__orb--a");
      expect(HUB_LOGIN_PAGE).toContain("hub-login-backdrop__grid");
      expect(HUB_LOGIN_PAGE).toContain("hub-login-backdrop__beam");
      expect(HUB_LOGIN_PAGE).toContain("hub-login-backdrop__ring--delay");
      expect(HUB_LOGIN_PAGE).toContain("FLOATING_PARTICLES");
      expect(HUB_LOGIN_PAGE).toContain("hub-login-backdrop__particle");
      expect(HUB_LOGIN_PAGE).toContain("hub-login-backdrop__vignette");
      expect(HUB_LOGIN_PAGE).toContain("hub-login-card-shell");
      expect(HUB_LOGIN_PAGE).toContain("hub-login-card-inner");
      expect(HUB_LOGIN_PAGE).not.toContain("motion.div");
    });

    it("App.tsx wraps hub/admin routes in HubPortalGate + persistent AdminPortalLayout", () => {
      expect(APP_TSX).toContain("HubPortalGate");
      expect(APP_TSX).toContain("AdminPortalLayout");
    });
  });

  describe("React route table covers every SPA-owned page", () => {
    const expectedRoutes = [
      "/",
      "/hub",
      "/hub/features",
      "/hub/brand",
      "/hub/coverage",
      "/hub/tests",
      "/hub/diagnostics",
      "/hub/logs",
      "/hub/traces",
      "/hub/queries",
      "/hub/migrations",
      "/hub/jobs",
      "/hub/routes",
      "/hub/erd",
      "/hub/emails",
      "/hub/email-preview",
      "/hub/email-builder",
      "/hub/postgrest-parse",
      "/hub/files",
      "/hub/cron",
      "/hub/email-outbox",
      "/admin/permissions/test",
      "/admin/sessions",
      "/admin/jobs",
      "/admin/users",
      "/admin/tenants",
      "/admin/rate-limits",
      "/admin/roles",
      "/admin/policies",
      "/admin/permissions",
      "/admin/webhooks",
      "/admin/realtime",
      "/admin/audit",
      "/admin/search",
      "/errors",
      "/openapi",
    ];

    for (const path of expectedRoutes) {
      it(`App.tsx declares <Route path="${path}">`, () => {
        const escaped = path.replace(/\//g, "\\/");
        expect(APP_TSX).toMatch(new RegExp(`path="${escaped}"`));
      });
    }
  });

  describe("Sidebar SPA_ROUTES set tracks the React routes", () => {
    const spaPaths = [
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
      "/hub/routes",
      "/hub/erd",
      "/hub/emails",
      "/hub/postgrest-parse",
      "/hub/files",
      "/hub/cron",
      "/hub/email-outbox",
      "/admin/permissions/test",
      "/admin/sessions",
      "/admin/users",
      "/admin/tenants",
      "/admin/rate-limits",
      "/admin/roles",
      "/admin/policies",
      "/admin/permissions",
      "/admin/webhooks",
      "/admin/realtime",
      "/admin/audit",
      "/admin/search",
      "/errors",
      "/openapi",
    ];
    for (const p of spaPaths) {
      it(`nav.ts SPA_ROUTES includes ${p}`, () => {
        expect(NAV_TS).toContain(`"${p}"`);
      });
    }
  });

  describe("Admin SPA controller exposes JSON sidecars for every page", () => {
    const adminEndpoints = [
      "permissions/test.json",
      "webhooks.json",
      "realtime.json",
      "audit.json",
      "search.json",
    ];
    for (const ep of adminEndpoints) {
      it(`admin-spa.controller.ts declares @Get("${ep}")`, () => {
        const escaped = ep.replace(/\./g, "\\.");
        expect(ADMIN_SPA_CONTROLLER).toMatch(new RegExp(`@Get\\("${escaped}"\\)`));
      });
    }
  });

  describe("AuditBrowserPage loads audit.json with tenant scope", () => {
    it("AuditBrowserPage.tsx loads audit via session bootstrap + fetchJson", () => {
      expect(AUDIT_BROWSER_PAGE).toContain("bootstrapHubOperatorSession");
      expect(AUDIT_BROWSER_PAGE).toContain("fetchJson<AuditBrowserResponse>");
      expect(AUDIT_BROWSER_PAGE).toContain("/admin/audit.json");
      expect(AUDIT_BROWSER_PAGE).not.toContain("x-tenant-id");
    });

    it("admin-spa.controller.ts scopes auditBrowserJson via requireTenantContext", () => {
      expect(ADMIN_SPA_CONTROLLER).toContain("requireTenantContext");
    });

    it("AdminSpaController is @Public Hub surface behind the tiered surface guard", () => {
      expect(ADMIN_SPA_CONTROLLER).toMatch(/@Public\([^)]*surface guard[^)]*local development/);
      expect(ADMIN_SPA_CONTROLLER).toContain("private assertOperational()");
      expect(ADMIN_SPA_CONTROLLER).toContain("private assertWorkstation()");
    });
  });

  describe("FeaturesPage toggle POST matches HubController @Controller(hub)", () => {
    it("FeaturesPage.tsx POSTs to /hub/features/:key/toggle (not legacy /dev)", () => {
      expect(FEATURES_PAGE).toMatch(/\/hub\/features\/\$\{/);
      expect(FEATURES_PAGE).not.toMatch(/fetch\(`\/dev\/features\//);
    });

    it('hub.controller.ts declares @Post("features/:key/toggle")', () => {
      expect(CONTROLLER).toMatch(/@Post\("features\/:key\/toggle"\)/);
    });
  });

  describe("Server controller exposes every JSON endpoint the React pages consume", () => {
    const jsonEndpoints = [
      "portal-access.json",
      "dashboard.json",
      "status.json",
      "feature-catalog.json",
      "features.json",
      "diagnostics.json",
      "logs.json",
      "traces.json",
      "queries.json",
      "routes.json",
      "erd.json",
      "email-preview.json",
      "emails/templates.json",
      "emails/blocks.json",
      "coverage.json",
      "tests.json",
      "jobs/queues.json",
      "jobs/jobs.json",
    ];
    for (const ep of jsonEndpoints) {
      it(`hub.controller.ts declares @Get for "${ep}"`, () => {
        // Match `@Get("foo.json")` or `@Get([..., "foo.json", ...])` —
        // email routes register both `/hub/emails/*` and legacy
        // `/hub/email-builder/*` paths on one handler.
        const escaped = ep.replace(/\./g, "\\.");
        const single = new RegExp(`@Get\\("${escaped}"\\)`);
        const inArray = new RegExp(`@Get\\(\\[[^\\]]*"${escaped}"[^\\]]*\\]\\)`);
        expect(CONTROLLER).toMatch(new RegExp(`${single.source}|${inArray.source}`));
      });
    }
  });

  describe("Tailwind theme is wired to the dev-portal tokens", () => {
    // After the shadcn migration the page chrome lives in Tailwind
    // utility classes that resolve to the same dev-portal CSS-vars the
    // brand-loader writes (Issue #5). The contract that survives is
    // "every shadcn semantic colour points back at our token" — so
    // brand changes still propagate everywhere.
    const themeBridges = [
      "--color-background: var(--bg)",
      "--color-foreground: var(--fg)",
      "--color-card: var(--surface-1)",
      "--color-primary: var(--accent)",
      "--color-primary-foreground: var(--accent-ink)",
      "--color-muted: var(--surface-2)",
      "--color-muted-foreground: var(--fg-muted)",
      "--color-accent: var(--accent)",
      "--color-destructive: var(--err)",
      "--color-border: var(--line)",
      "--color-ring: var(--accent)",
    ];
    for (const decl of themeBridges) {
      it(`globals.css declares the @theme bridge ${decl}`, () => {
        expect(GLOBALS_CSS).toContain(decl);
      });
    }

    it("globals.css imports tailwindcss", () => {
      expect(GLOBALS_CSS).toContain('@import "tailwindcss"');
    });
  });

  describe("Admin portal layout keeps persistent sidebar chrome", () => {
    const chrome = `${ADMIN_SHELL}\n${ADMIN_PORTAL_LAYOUT}`;
    const structuralAnchors = [
      "<aside",
      "<main",
      "<nav",
      "<header",
      "online",
      'to="/hub"',
      "AdminPortalLayout",
      "AdminSidebar",
    ];
    for (const fragment of structuralAnchors) {
      it(`layout chrome contains ${JSON.stringify(fragment)}`, () => {
        expect(chrome).toContain(fragment);
      });
    }
  });

  describe("tokens.css carries the dev-portal design tokens", () => {
    const tokens = [
      "--bg",
      "--surface-1",
      "--surface-2",
      "--surface-3",
      "--surface-hover",
      "--line",
      "--line-strong",
      "--line-accent",
      "--fg",
      "--fg-muted",
      "--fg-dim",
      "--fg-faint",
      "--accent",
      "--accent-soft",
      "--accent-glow",
      "--accent-ink",
      "--ok",
      "--warn",
      "--err",
      "--radius",
      "--radius-sm",
      "--radius-lg",
      "--shadow-soft",
      "--shadow-lift",
      "--shadow-glow",
      "--ease",
      "--ease-out",
      "--font-sans",
      "--font-mono",
    ];
    for (const tok of tokens) {
      it(`tokens.css declares ${tok}`, () => {
        expect(TOKENS_CSS).toContain(tok);
      });
    }

    it("the iconic electric-lime accent #c5fb45 is preserved verbatim", () => {
      expect(TOKENS_CSS).toContain("#c5fb45");
    });
  });

  describe("Sidebar nav.ts declares every section/page id", () => {
    const ids = [
      "hub",
      "diagnostics",
      "features",
      "brand",
      "coverage",
      "tests",
      "logs",
      "traces",
      "queries",
      "migrations",
      "jobs",
      "cron",
      "email-outbox",
      "scalar",
      "openapi",
      "routes",
      "errors",
      "erd",
      "emails",
      "prisma-studio",
      "users",
      "tenants",
      "sessions",
      "roles",
      "policies",
      "permissions-crud",
      "permissions",
      "rate-limits",
      "webhooks",
      "realtime",
      "audit",
      "search",
      "files",
    ];
    for (const id of ids) {
      it(`nav.ts declares sidebar entry id="${id}"`, () => {
        expect(NAV_TS).toContain(`id: "${id}"`);
      });
    }
  });

  describe("Sidebar icons render with stroke=currentColor (regression pin · #48)", () => {
    // Without `stroke="currentColor"` on the shared `COMMON` props every
    // `<path>` rendered with `fill="none"` is invisible in the DOM —
    // exactly the regression that landed with the shadcn migration in
    // PR #41. Pin the four Lucide-style stroke attributes so a future
    // refactor can't silently drop them again.
    it('icons.tsx COMMON declares stroke: "currentColor"', () => {
      expect(ICONS_TSX).toMatch(/stroke:\s*"currentColor"/);
    });

    it("icons.tsx COMMON declares strokeWidth", () => {
      expect(ICONS_TSX).toMatch(/strokeWidth:\s*1\.75/);
    });

    it('icons.tsx COMMON declares strokeLinecap: "round"', () => {
      expect(ICONS_TSX).toMatch(/strokeLinecap:\s*"round"/);
    });

    it('icons.tsx COMMON declares strokeLinejoin: "round"', () => {
      expect(ICONS_TSX).toMatch(/strokeLinejoin:\s*"round"/);
    });
  });

  describe("CopyButton component — copy-to-clipboard for code blocks (fix · #126)", () => {
    it("CopyButton.tsx exists as a standalone component file", () => {
      expect(COPY_BUTTON).toBeTruthy();
    });

    it("CopyButton.tsx uses the Clipboard API (navigator.clipboard.writeText)", () => {
      expect(COPY_BUTTON).toContain("navigator.clipboard.writeText");
    });

    it("CopyButton.tsx renders a button element", () => {
      expect(COPY_BUTTON).toMatch(/<button/);
    });

    it("CopyButton.tsx exports CopyButton function", () => {
      expect(COPY_BUTTON).toMatch(/export function CopyButton/);
    });

    it("TestsPage.tsx imports CopyButton", () => {
      expect(TESTS_PAGE).toContain("CopyButton");
    });

    it("CoveragePage.tsx imports CopyButton", () => {
      expect(COVERAGE_PAGE).toContain("CopyButton");
    });
  });

  describe("Inline code spacing fix (fix · #126)", () => {
    it("TestsPage.tsx inline command code uses mx-0.5 for spacing", () => {
      expect(TESTS_PAGE).toContain("mx-0.5");
    });

    it("CoveragePage.tsx inline command code uses mx-0.5 for spacing", () => {
      expect(COVERAGE_PAGE).toContain("mx-0.5");
    });
  });

  describe("Sidebar active-state: permissions pages use distinct currentNav ids (regression pin · #125)", () => {
    it('PermissionsAdminPage passes currentNav="permissions-crud" to AdminShell', () => {
      expect(PERMISSIONS_ADMIN_PAGE).toContain('currentNav="permissions-crud"');
    });

    it("PermissionsAdminPage is matrix-only (no manual create form or list table)", () => {
      expect(PERMISSIONS_ADMIN_PAGE).toContain("Permission matrix");
      expect(PERMISSIONS_ADMIN_PAGE).toContain("Checkbox");
      expect(PERMISSIONS_ADMIN_PAGE).not.toContain("Neue Permission");
      expect(PERMISSIONS_ADMIN_PAGE).not.toContain('data-action="create-permission"');
    });

    it('PermissionTesterPage passes currentNav="permissions" to AdminShell', () => {
      expect(PERMISSION_TESTER_PAGE).toContain('currentNav="permissions"');
    });

    it('nav.ts assigns id "permissions-crud" to the /admin/permissions CRUD entry', () => {
      expect(NAV_TS).toContain('id: "permissions-crud"');
    });

    it('nav.ts "permissions-crud" entry has href "/admin/permissions" (exact path)', () => {
      expect(NAV_TS).toMatch(/id: "permissions-crud"[^}]+href: "\/admin\/permissions"/s);
    });
  });
});
