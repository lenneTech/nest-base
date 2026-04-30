# Extending the Dev Hub

The dev-hub at `/dev` and the `/admin/*` pages share a single dark-mode
layout (pure-black + electric-lime accent `#c5fb45`). Every new page
should plug into that shell instead of rolling its own HTML — the user
gets a consistent navigation, the page inherits the responsive breakpoints,
and Inter + JetBrains-Mono load once.

This skill covers the two common cases:

1. **Add a JSON endpoint** that should render with the JSON viewer
   instead of dumping `application/json` to the browser.
2. **Add a brand-new admin page** with a custom layout.

---

## Case 1 — Wrap a JSON endpoint in the JSON viewer

The pattern: same controller route, content-negotiation between HTML
(browser default) and raw JSON (SDK consumers via `Accept: application/json`
or `?format=json`).

### Reference implementation

`src/core/errors/error-code.controller.ts:list()` is the canonical
example.

```typescript
import { Controller, Get, Headers, Inject, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { renderJsonViewerPage } from "../dx/json-viewer-ui.js";

@Controller("things")
export class ThingsController {
  @Get()
  list(
    @Headers("accept") accept: string | undefined,
    @Query("format") format: string | undefined,
    @Res() res: Response,
  ): void {
    const data = this.gatherThings();
    if (wantsJson(accept, format)) {
      res.type("application/json").send(JSON.stringify(data));
      return;
    }
    res.type("text/html; charset=utf-8").send(
      renderJsonViewerPage({
        title: "Things",
        subtitle: "Optional sub-text",
        currentNav: "things", // matches the sidebar entry id
        value: data,
        rawJsonHref: "/things?format=json",
      }),
    );
  }
}

function wantsJson(accept: string | undefined, format: string | undefined): boolean {
  if (format === "json") return true;
  if (format === "html") return false;
  if (!accept) return false;
  const lower = accept.toLowerCase();
  if (lower.includes("text/html")) return false;
  return lower.includes("application/json");
}
```

### Tenant-exemption (if the route is public)

If the page is dev-only or public, add the path prefix to the exempt
list in `src/core/multi-tenancy/tenant-guard.ts`:

```typescript
const EXEMPT_EXACT = new Set(["/", "/errors", "/things"]);
const EXEMPT_PREFIXES = ["/health/", "/api/auth/", "/dev/", "/admin/", ...];
```

The `isTenantExempt()` helper strips query strings + fragments before
matching, so `/things?format=json` resolves correctly.

### Sidebar entry

`src/core/dx/admin-layout.ts` — add to the appropriate section:

```typescript
{ id: "things", label: "Things", href: "/things", icon: ICON_LIST },
```

If you need a new icon, add it to the `ICON_*` constants at the bottom
of the file (16x16 SVG path, single colour, stroke-width 2).

### Story test

`tests/stories/json-viewer-ui.story.test.ts` already covers the renderer.
For your endpoint, add an e2e test that verifies content negotiation:

```typescript
it("returns HTML for browsers", async () => {
  const res = await request(app.getHttpServer()).get("/things").set("Accept", "text/html");
  expect(res.headers["content-type"]).toMatch(/text\/html/);
  expect(res.text).toContain("jv__root");
});

it("returns JSON when Accept: application/json", async () => {
  const res = await request(app.getHttpServer()).get("/things").set("Accept", "application/json");
  expect(res.headers["content-type"]).toMatch(/application\/json/);
});

it("returns JSON when ?format=json overrides Accept", async () => {
  const res = await request(app.getHttpServer())
    .get("/things?format=json")
    .set("Accept", "text/html");
  expect(res.headers["content-type"]).toMatch(/application\/json/);
});
```

---

## Case 2 — Add a brand-new admin/dev page with custom layout

### Reference implementations

- `src/core/dx/dashboard-ui.ts` — the cockpit, mixes hero + stats grid + cards
- `src/core/dx/features-ui.ts` — feature catalog with toggles + restart overlay
- `src/core/dx/coverage-ui.ts` — totals tiles + per-file table
- `src/core/dx/test-summary-ui.ts` — pass/fail tiles + failure snippets

### The pattern

Every page is a **pure renderer** that takes a typed input, returns a
string, and wraps the body via `renderAdminLayout`:

```typescript
// src/core/dx/things-ui.ts
import { renderAdminLayout } from "./admin-layout.js";

export interface ThingsPageInput {
  things: ReadonlyArray<{ id: string; status: "ok" | "warn" | "err" }>;
}

export function renderThingsPage(input: ThingsPageInput): string {
  const body = `
<style>
  /* Page-specific CSS — uses the layout's CSS variables */
  .thing-card { background: var(--surface-2); border: 1px solid var(--line); ... }
</style>

<div class="admin-card">
  <h2 class="admin-card__title">Things (${input.things.length})</h2>
  ${input.things.length === 0 ? renderEmpty() : renderTable(input.things)}
</div>
`;
  return renderAdminLayout({
    title: "Things",
    subtitle: "Live overview of all the things this server is tracking.",
    currentNav: "things",
    body,
  });
}

function renderEmpty() { return `<div class="admin-empty">Nothing yet.</div>`; }

function renderTable(things: ...) { /* ... */ }

function escapeHtml(input: string): string { /* ... five-char table */ }
```

### Theme tokens you can use

Always use these CSS variables — they auto-adapt to the theme:

| Variable                                                     | Purpose                                            |
| ------------------------------------------------------------ | -------------------------------------------------- |
| `--bg`, `--surface-1`, `--surface-2`, `--surface-3`          | Background layers (near-black to elevated)         |
| `--fg`, `--fg-muted`, `--fg-dim`, `--fg-faint`               | Text contrast tiers                                |
| `--accent`, `--accent-soft`, `--accent-glow`, `--accent-ink` | Lime accent + ink for accent backgrounds           |
| `--ok`, `--warn`, `--err`                                    | Status semantics                                   |
| `--line`, `--line-strong`, `--line-accent`                   | Border tiers                                       |
| `--radius`, `--radius-sm`, `--radius-lg`                     | Corner radii                                       |
| `--ease`, `--ease-out`                                       | Premium easing curves (cubic-bezier(0.16,1,0.3,1)) |
| `--font-sans`, `--font-mono`                                 | Inter + JetBrains Mono                             |

### Reusable component classes

| Class                              | What it gives you                                             |
| ---------------------------------- | ------------------------------------------------------------- |
| `.admin-card`                      | Padded surface with border, hover-lift on `:hover`            |
| `.admin-card--accent`              | Card with lime border                                         |
| `.admin-card__title`               | Semibold heading inside a card                                |
| `.admin-empty`                     | Dashed-border empty state                                     |
| `.admin-meta`                      | Muted body text                                               |
| `.admin-table`                     | Styled table — pair with `tr[data-*]` selectors for row tints |
| `.admin-grid.admin-grid--2/--3`    | 2/3-column grid of cards                                      |
| `.admin-form` + `.row`             | Inline form layout                                            |
| `.admin-link-list`                 | Vertical list of links with hover-lift                        |
| `.admin-badge.--ok/.--warn/.--err` | Status pills with pulse on `--ok`                             |

### Sidebar entry + currentNav id

`src/core/dx/admin-layout.ts:defaultAdminNav()` — pick the right
section (Übersicht / API & Docs / Admin) and add the entry. The `id`
is what you pass as `currentNav` from the renderer so the sidebar
highlights the active item.

### Wire the controller

```typescript
// src/core/dx/things.controller.ts (or extend dev-hub.controller.ts)
@Controller("things")
export class ThingsController {
  @Get()
  @Header("content-type", "text/html; charset=utf-8")
  index(): string {
    const things = this.gatherThings();
    return renderThingsPage({ things });
  }
}
```

If the page is dev-only, gate via `serverConfigFromEnv(process.env).env`:

```typescript
private assertDev(): void {
  const cfg = serverConfigFromEnv(process.env);
  if (cfg.env !== "development") throw new NotFoundException();
}
```

### Story test

```typescript
// tests/stories/things-ui.story.test.ts
import { describe, expect, it } from "vitest";
import { renderThingsPage } from "../../src/core/dx/things-ui.js";

describe("Story · Things UI", () => {
  it("rendert HTML mit Title und Body-Slot", () => {
    const html = renderThingsPage({ things: [] });
    expect(html).toContain("<title>Things — nest-server</title>");
    expect(html).toContain("Nothing yet");
  });

  it("eskapiert XSS in Daten", () => {
    const html = renderThingsPage({
      things: [{ id: "<script>alert(1)</script>", status: "ok" }],
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
```

### Coverage exclusion

UI renderer files (`*-ui.ts` in `src/core/dx/`) are pre-excluded from
the coverage gate (see `vitest.config.ts`). They're glue — the visible
quality bar is the story-test + the live page. **Don't** add functional
logic to UI files; if you find yourself writing branches that need
coverage, extract them into a sibling `*.ts` (planner) and let the UI
file just compose strings.

---

## Layout rules to keep the design coherent

1. **One primary action per page.** Lime CTA, everything else neutral.
2. **Tabular figures for numbers.** Add `font-variant-numeric: tabular-nums`
   to anything with values that update — prevents column shift.
3. **Lime is for "good / active / primary" only.** Errors stay red,
   warnings amber. Never lime an error pill.
4. **Hover-lift, not snap.** `transition: ... .25s var(--ease)` on
   anything interactive. `transform: translateY(-1px)` on hover-lift.
5. **Pulse on live indicators only.** Status dots that represent
   real-time state get the `pulse 2s ease-in-out infinite` animation.
6. **HTML-escape every user-controlled value.** The renderers' callers
   pass trusted HTML for the body, but data inside the body must go
   through `escapeHtml()`.

---

## Don't

- **Don't roll your own `<html>`/`<head>`.** Always go through
  `renderAdminLayout`.
- **Don't hard-code colours.** Use the CSS variables.
- **Don't use emojis as icons** — inline SVG only (see `ICON_*` in
  `admin-layout.ts`).
- **Don't pull external CSS frameworks.** The dev-hub is intentionally
  zero-build, ~25KB inline CSS, no client framework.
- **Don't skip the story test.** Even pure renderers need an XSS
  assertion + a structural assertion.
