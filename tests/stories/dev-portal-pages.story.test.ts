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
const GLOBALS_CSS = read("src/core/dx/clients/styles/globals.css");
const TOKENS_CSS = read("src/core/dx/clients/styles/tokens.css");
const ADMIN_SHELL = read("src/core/dx/clients/layout/AdminShell.tsx");

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
      "/dev/email-builder",
      "/dev/postgrest-parse",
      "/dev/files",
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
      "/dev/email-builder",
      "/dev/components",
      "/dev/postgrest-parse",
      "/dev/files",
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
      "email-builder/templates.json",
      "email-builder/blocks.json",
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

  describe("AdminShell renders the structural identity of the dev-portal", () => {
    // Spot-check the shell still emits the headline elements the SPA
    // depends on. The legacy admin-* class catalogue is gone but the
    // structural contract (sidebar / main / header / online badge /
    // brand block) holds across the migration.
    const structuralAnchors = [
      "<aside",
      "<main",
      "<nav",
      "<header",
      "online",
      "NestJS Docs",
      "to=\"/dev\"",
    ];
    for (const fragment of structuralAnchors) {
      it(`AdminShell.tsx contains ${JSON.stringify(fragment)}`, () => {
        expect(ADMIN_SHELL).toContain(fragment);
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
      "email-builder",
      "prisma-studio",
      "permissions",
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
});
