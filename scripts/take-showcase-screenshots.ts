/**
 * Capture every developer-facing dev-portal page at desktop + mobile
 * viewports for `docs/showcase/screenshots/`.
 *
 * Why this script exists: the README + `docs/showcase/README.md` embed
 * those PNGs to give a fresh contributor (human or agent) a feel for
 * what the cockpit looks like before they boot the server. The shadcn
 * migration (PR #41) reshaped every page; this script is the one-shot
 * way to refresh the gallery so README links never go stale again.
 *
 * Run it manually whenever the UI has visibly changed:
 *
 *   bun run docs:screenshots
 *
 * The script is intentionally **not** wired into CI. It needs a live
 * dev server, a headless Chrome (Playwright manages its own download),
 * and writes binary blobs into the repo — none of which CI should do
 * on every PR.
 *
 * ## Prerequisites
 *
 * 1. A dev server reachable via `BASE_URL` (default
 *    `http://localhost:3000`). Start it with `bun run dev` in another
 *    shell. The script does **not** boot the API itself — that keeps
 *    each side single-responsibility.
 * 2. Postgres reachable for the API (the dev runner boots Postgres
 *    automatically via `docker compose up -d postgres`).
 * 3. A reachable Better-Auth sign-up endpoint. The script signs up a
 *    deterministic `screenshot-bot@example.com` account, signs in,
 *    and stores the cookie in the Playwright browser context so the
 *    `/admin/*` routes (which require an authenticated session) render
 *    instead of redirecting to the unauthorized page.
 * 4. Playwright + Chromium. On first run:
 *
 *      bun add -d playwright
 *      bunx playwright install chromium
 *
 *    These are dev-only — production never installs them. Skip this
 *    if Playwright is already present.
 *
 * ## Output
 *
 * For every page in `PAGES`, two PNGs land under
 * `docs/showcase/screenshots/`:
 *
 * - `<slug>-desktop.png` (1440×900 viewport)
 * - `<slug>-mobile.png`  (390×844 viewport, `iPhone 14 Pro` device)
 *
 * Filenames are deterministic so existing README embeds keep working
 * across re-runs.
 *
 * ## Limitations
 *
 * - **Auth**: Better-Auth issues `__Secure-`-prefixed cookies whenever
 *   `APP_BASE_URL` starts with `https://`. On the default localhost
 *   loopback (`http://localhost:<port>`) this is fine; against a
 *   portless / TLS-fronted dev URL the script's sign-in attempt will
 *   succeed but the cookie is rejected by HTTP requests — set
 *   `APP_BASE_URL=http://localhost:<port>` in `.env` for the duration
 *   of the screenshot run.
 * - **CSP**: the dev-portal CSP currently allows `localhost:*` for
 *   `connect-src`, so Playwright's headless Chromium can talk to the
 *   API without policy adjustments.
 * - **Throttling**: a fresh sign-up may collide with rate-limit on
 *   `/api/auth/sign-up/email` if you re-run the script back-to-back —
 *   wait a minute or change the bot email via `SCREENSHOT_BOT_EMAIL`.
 */

// Use a dynamic import so the script imports cleanly when Playwright
// isn't installed yet — the operator gets a useful error instead of a
// confusing module-not-found.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type { Browser, BrowserContext, Page } from "playwright";

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

interface PageSpec {
  /** Filename slug (without `-desktop.png` / `-mobile.png`). */
  slug: string;
  /** URL path joined to `BASE_URL`. */
  path: string;
  /** Page-load condition — wait for any of these texts before snapping. */
  waitFor: string[];
  /** When `true`, sign-in cookie required (admin/* pages). */
  requiresAuth?: boolean;
}

// Mirrors every <Route> declared in `src/core/dx/clients/App.tsx`.
// SC.DX requires `bun run docs:screenshots` to reproduce every dev-portal
// page; the structural test
// `tests/stories/showcase-screenshots-coverage.story.test.ts` pins the
// 1:1 correspondence so a new route can't ship without a screenshot
// entry.
const PAGES: PageSpec[] = [
  // Dev portal
  { slug: "hub-landing", path: "/hub", waitFor: ["Hub", "Cockpit"] },
  { slug: "hub-components", path: "/hub/components", waitFor: ["Components", "shadcn"] },
  { slug: "hub-features", path: "/hub/features", waitFor: ["Multi-Tenancy", "Feature flags"] },
  { slug: "hub-brand", path: "/hub/brand", waitFor: ["Brand"] },
  { slug: "hub-coverage", path: "/hub/coverage", waitFor: ["Coverage", "no run yet", "Lines"] },
  { slug: "hub-tests", path: "/hub/tests", waitFor: ["Tests"] },
  { slug: "hub-diagnostics", path: "/hub/diagnostics", waitFor: ["Diagnostics"] },
  { slug: "hub-logs", path: "/hub/logs", waitFor: ["Logs"] },
  { slug: "hub-traces", path: "/hub/traces", waitFor: ["Traces"] },
  { slug: "hub-queries", path: "/hub/queries", waitFor: ["Queries"] },
  { slug: "hub-migrations", path: "/hub/migrations", waitFor: ["Migrations", "Status"] },
  { slug: "hub-jobs", path: "/hub/jobs", waitFor: ["Jobs", "Queues"] },
  { slug: "hub-routes", path: "/hub/routes", waitFor: ["Routes"] },
  { slug: "hub-erd", path: "/hub/erd", waitFor: ["ERD"] },
  {
    slug: "hub-email-preview",
    path: "/hub/email-preview",
    waitFor: ["Email Preview", "verification"],
  },
  {
    slug: "hub-email-builder",
    path: "/hub/email-builder",
    waitFor: ["Email Builder", "Templates"],
  },
  { slug: "hub-postgrest-parse", path: "/hub/postgrest-parse", waitFor: ["PostgREST"] },
  { slug: "hub-json", path: "/hub/json", waitFor: ["JSON Viewer"] },
  { slug: "hub-files", path: "/hub/files", waitFor: ["File Manager"] },
  { slug: "hub-cron", path: "/hub/cron", waitFor: ["Cron"] },
  { slug: "hub-email-outbox", path: "/hub/email-outbox", waitFor: ["Email Outbox"] },
  // Admin pages (require auth)
  { slug: "admin-users", path: "/admin/users", waitFor: ["Benutzer"], requiresAuth: true },
  {
    slug: "admin-tenants",
    path: "/admin/tenants",
    waitFor: ["Mandantenverwaltung"],
    requiresAuth: true,
  },
  { slug: "admin-roles", path: "/admin/roles", waitFor: ["Roles"], requiresAuth: true },
  { slug: "admin-policies", path: "/admin/policies", waitFor: ["Policies"], requiresAuth: true },
  {
    slug: "admin-permissions",
    path: "/admin/permissions",
    waitFor: ["Permissions"],
    requiresAuth: true,
  },
  {
    slug: "admin-permissions-test",
    path: "/admin/permissions/test",
    waitFor: ["Permission Tester"],
    requiresAuth: true,
  },
  { slug: "admin-sessions", path: "/admin/sessions", waitFor: ["Sessions"], requiresAuth: true },
  { slug: "admin-jobs", path: "/admin/jobs", waitFor: ["Jobs"], requiresAuth: true },
  {
    slug: "admin-webhooks",
    path: "/admin/webhooks",
    waitFor: ["Webhook Inspector", "Endpoints"],
    requiresAuth: true,
  },
  {
    slug: "admin-realtime",
    path: "/admin/realtime",
    waitFor: ["Realtime Inspector", "Sockets"],
    requiresAuth: true,
  },
  { slug: "admin-audit", path: "/admin/audit", waitFor: ["Audit Browser"], requiresAuth: true },
  { slug: "admin-search", path: "/admin/search", waitFor: ["Search Tester"], requiresAuth: true },
  {
    slug: "admin-rate-limits",
    path: "/admin/rate-limits",
    waitFor: ["Inspektor", "Konfiguration"],
    requiresAuth: true,
  },
  // Public catalogues
  { slug: "errors", path: "/errors", waitFor: ["Error Catalog", "CORE_"] },
  { slug: "openapi", path: "/api/openapi", waitFor: ["OpenAPI", "openapi"] },
];

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const BOT_EMAIL = process.env.SCREENSHOT_BOT_EMAIL ?? "screenshot-bot@example.com";
const BOT_PASSWORD = process.env.SCREENSHOT_BOT_PASSWORD ?? "ScreenshotBotPass1234567";
const OUT_DIR = resolve(process.cwd(), "docs/showcase/screenshots");
const DESKTOP_VIEWPORT = { width: 1440, height: 900 } as const;
const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

async function main(): Promise<void> {
  const playwright = await loadPlaywright();
  const browser: Browser = await playwright.chromium.launch({ headless: true });

  try {
    await mkdir(OUT_DIR, { recursive: true });
    await ensureBotAccount();

    for (const viewport of [DESKTOP_VIEWPORT, MOBILE_VIEWPORT] as const) {
      const suffix = viewport === DESKTOP_VIEWPORT ? "desktop" : "mobile";
      // One context per viewport so the auth cookie lands once and is
      // re-used for every page in that pass — saves Better-Auth from a
      // sign-in storm and keeps the screenshots reproducible.
      const context: BrowserContext = await browser.newContext({ viewport });
      try {
        await signIn(context);
        for (const spec of PAGES) {
          await capture(context, spec, suffix);
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`[showcase] wrote ${PAGES.length * 2} screenshots to ${OUT_DIR}`);
}

async function ensureBotAccount(): Promise<void> {
  // Better-Auth's sign-up is idempotent-ish: a duplicate email returns
  // 400. Treat any non-2xx that isn't a duplicate as fatal so the
  // operator notices a misconfigured server instead of a silent skip.
  const response = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: BOT_EMAIL, password: BOT_PASSWORD, name: "Screenshot Bot" }),
  });
  if (response.status === 200 || response.status === 201) {
    console.log(`[showcase] created bot account ${BOT_EMAIL}`);
    return;
  }
  const body = await response.text();
  if (response.status === 400 && body.includes("USER_ALREADY_EXISTS")) {
    console.log(`[showcase] bot account ${BOT_EMAIL} already exists`);
    return;
  }
  throw new Error(`[showcase] sign-up failed: ${response.status} ${body}`);
}

async function signIn(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  try {
    const result = await page.evaluate(
      async (input: { baseUrl: string; email: string; password: string }) => {
        const r = await fetch(`${input.baseUrl}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email: input.email, password: input.password }),
        });
        return { status: r.status, body: await r.text() };
      },
      { baseUrl: BASE_URL, email: BOT_EMAIL, password: BOT_PASSWORD },
    );
    if (result.status !== 200) {
      throw new Error(`[showcase] sign-in failed: ${result.status} ${result.body}`);
    }
  } finally {
    await page.close();
  }
}

async function capture(context: BrowserContext, spec: PageSpec, suffix: string): Promise<void> {
  const page: Page = await context.newPage();
  try {
    const url = `${BASE_URL}${spec.path}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await Promise.race([
      ...spec.waitFor.map((text) =>
        page.getByText(text, { exact: false }).first().waitFor({ timeout: 10_000 }),
      ),
    ]);
    // Allow lazy chunks + JSON sidecars to settle. 250 ms is enough
    // for everything except `/dev/coverage` on a cold start; we accept
    // the occasional empty-state for that page rather than block here.
    await page.waitForTimeout(500);
    const file = resolve(OUT_DIR, `${spec.slug}-${suffix}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`[showcase] ${file}`);
  } catch (err) {
    console.warn(`[showcase] ${spec.slug}-${suffix}: ${(err as Error).message}`);
  } finally {
    await page.close();
  }
}

async function loadPlaywright(): Promise<typeof import("playwright")> {
  try {
    return await import("playwright");
  } catch {
    throw new Error(
      "[showcase] Playwright is not installed. Run:\n" +
        "  bun add -d playwright\n" +
        "  bunx playwright install chromium",
    );
  }
}

await main();
