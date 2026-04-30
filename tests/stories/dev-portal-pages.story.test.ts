import { describe, expect, it } from "vitest";

/**
 * Story · Dev-Portal SPA route + nav contract.
 *
 * The React `App.tsx` and the sidebar nav (`clients/layout/nav.ts`)
 * must stay in lock-step:
 *   - every SPA route is owned by a page chunk in `App.tsx`
 *   - every SPA-owned `/dev/*` URL appears in the sidebar so users
 *     can navigate to it without typing the URL
 *   - every `*.json` endpoint the React pages consume actually exists
 *     on the server (`dev-hub.controller.ts` declares it)
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
const CONTROLLER = read("src/core/dx/dev-hub.controller.ts");
const ADMIN_SPA_CONTROLLER = read("src/core/dx/admin-spa.controller.ts");
const ADMIN_LAYOUT_CSS = read("src/core/dx/clients/styles/admin-layout.css");
const TOKENS_CSS = read("src/core/dx/clients/styles/tokens.css");

describe("Story · Dev-Portal SPA route + nav contract", () => {
  describe("React route table covers every SPA-owned page", () => {
    const expectedRoutes = [
      "/dev",
      "/dev/components",
      "/dev/features",
      "/dev/coverage",
      "/dev/tests",
      "/dev/diagnostics",
      "/dev/logs",
      "/dev/traces",
      "/dev/queries",
      "/dev/jobs",
      "/dev/routes",
      "/dev/erd",
      "/dev/email-preview",
      "/dev/postgrest-parse",
      "/admin/permissions/test",
      "/admin/webhooks",
      "/admin/realtime",
      "/admin/audit",
      "/admin/search",
      "/errors",
      "/api/openapi",
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
      "/dev",
      "/dev/diagnostics",
      "/dev/features",
      "/dev/coverage",
      "/dev/tests",
      "/dev/logs",
      "/dev/traces",
      "/dev/queries",
      "/dev/jobs",
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

  describe("Server controller exposes every JSON endpoint the React pages consume", () => {
    const jsonEndpoints = [
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
      "coverage.json",
      "tests.json",
      "jobs/queues.json",
      "jobs/jobs.json",
    ];
    for (const ep of jsonEndpoints) {
      it(`dev-hub.controller.ts declares @Get("${ep}")`, () => {
        // Match `@Get("foo.json")` allowing for the literal dot — tests
        // are checking the routing decoration, not just the existence
        // of the string in any context.
        const escaped = ep.replace(/\./g, "\\.");
        expect(CONTROLLER).toMatch(new RegExp(`@Get\\("${escaped}"\\)`));
      });
    }
  });

  describe("Visual-fidelity classnames are present in admin-layout.css", () => {
    // Sentinels per page — if any of these go missing we've broken the
    // 1:1 port from `*-ui.ts`. The full list of classes ports verbatim;
    // these are spot checks on the most-load-bearing ones.
    const classes = [
      // Shell
      ".admin-shell",
      ".admin-sidebar",
      ".admin-nav__link--active",
      ".admin-card",
      ".admin-page__title",
      ".admin-badge--ok",
      // Hero / stats / services
      ".hero",
      ".hero__metric",
      ".stat-card",
      ".stat-card__pill--ok",
      ".svc",
      ".svc__dot--up",
      ".dash-log__chip--info",
      ".feat-row--on",
      ".quick",
      // Features
      ".feat-summary",
      '.feat-card[data-on="true"]',
      ".feat-toggle",
      ".feat-restart",
      // Coverage
      ".cov-totals",
      ".cov-tile__fill--ok",
      ".cov-gate--ok",
      ".cov-scroll",
      // Tests
      ".test-totals",
      ".test-pill--passed",
      ".test-row--failed",
      // Diagnostics
      ".diag-grid",
      ".diag-bar__fill--bad",
      ".diag-pill",
      // Routes
      ".ri-tiles",
      ".ri-method--GET",
      ".ri-guard--can",
      // Traces
      ".tv-tiles",
      ".tv-row--expanded",
      ".tv-drill__sql",
      // Queries
      ".qv-tiles",
      ".qv-dur--bad",
      // Logs
      ".log-scroll",
      ".log-level--error",
      ".log-jump",
      // Email preview
      ".ep-card",
      ".ep-html",
      // ERD
      ".erd-card",
      ".erd-canvas",
      // JSON viewer
      ".jv__node",
      ".jv__key--match",
      ".jv__copied",
    ];
    for (const cls of classes) {
      it(`admin-layout.css declares ${cls}`, () => {
        expect(ADMIN_LAYOUT_CSS).toContain(cls);
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
      "dev-hub",
      "diagnostics",
      "features",
      "coverage",
      "tests",
      "logs",
      "traces",
      "queries",
      "jobs",
      "scalar",
      "openapi",
      "routes",
      "errors",
      "erd",
      "email-preview",
      "prisma-studio",
      "permissions",
      "webhooks",
      "realtime",
      "audit",
      "search",
    ];
    for (const id of ids) {
      it(`nav.ts declares sidebar entry id="${id}"`, () => {
        expect(NAV_TS).toContain(`id: "${id}"`);
      });
    }
  });
});
