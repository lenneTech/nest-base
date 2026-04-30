---
description: Add a new dev-hub or admin page to the dark-mode shell (JSON viewer wrap or custom layout).
allowed-tools:
  - Read
  - Edit
  - Write
  - Bash
  - Grep
  - Glob
---

# /add-page

Adds a new page that lives in the dev-hub or admin sidebar, using
the shared dark-mode layout. Two flavours:

- **JSON viewer wrap** — for endpoints that return structured data
  (errors catalog, OpenAPI spec, parsed PostgREST query). One-liner:
  the controller calls `renderJsonViewerPage()`.
- **Custom layout** — for pages with their own UI (coverage report,
  log viewer). Write a renderer in `src/core/dx/<page>-ui.ts`.

Read `.claude/skills/extending-dev-hub.md` first — it has the full
walkthrough. This command sequences the steps under TDD.

## Arguments

```
/add-page <slug> "<title>" [<flavour>]
```

- **`<slug>`** — kebab-case URL fragment, e.g. `widgets` for `/dev/widgets`.
- **`<title>`** — display name, e.g. "Widget Inspector".
- **`<flavour>`** — `json-viewer` or `custom`. Default: ask the user.

If the page lives under `/admin/` instead of `/dev/`, prefix the slug
with `admin/` (e.g. `admin/orders`).

## Workflow

### 0 · Confirm before any edit

Echo the plan back to the user:

> I'll add a `<slug>` page titled "`<title>`" using the `<flavour>`
> pattern. It'll appear in the sidebar under `<section>` (Übersicht /
> API & Docs / Admin) and require an `id` of `<slug-as-id>`. Tenant-
> exempt: yes/no. Sound right?

Get explicit confirmation. Pin down: which sidebar section, which icon
(reuse an existing `ICON_*` or add a new SVG), tenant-exemption (yes
for public/dev, no for tenant-scoped business routes).

### 1 · Red — write the failing tests first

For **json-viewer** flavour, write `tests/<slug>.e2e-spec.ts`:

```typescript
it("returns HTML for browsers", async () => {
  const res = await request(app.getHttpServer()).get("/<slug>").set("Accept", "text/html");
  expect(res.headers["content-type"]).toMatch(/text\/html/);
  expect(res.text).toContain("jv__root");
  expect(res.text).toContain("<title><Title> — nest-server</title>");
});

it("returns JSON when Accept: application/json", async () => {
  const res = await request(app.getHttpServer()).get("/<slug>").set("Accept", "application/json");
  expect(res.headers["content-type"]).toMatch(/application\/json/);
});

it("returns JSON when ?format=json overrides Accept", async () => {
  const res = await request(app.getHttpServer())
    .get("/<slug>?format=json")
    .set("Accept", "text/html");
  expect(res.headers["content-type"]).toMatch(/application\/json/);
});
```

For **custom** flavour, write `tests/stories/<slug>-ui.story.test.ts`:

```typescript
it("rendert vollständiges HTML mit Title und Body-Slot", () => {
  const html =
    render <
    Slug >
    Page({
      /* minimal input */
    });
  expect(html).toMatch(/^<!doctype html>/i);
  expect(html).toContain("<title><Title> — nest-server</title>");
});

it("eskapiert XSS in User-Input", () => {
  const html =
    render <
    Slug >
    Page({
      /* input with <script> */
    });
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).toContain("&lt;script&gt;");
});

it("hebt aktiven Sidebar-Link hervor", () => {
  const html =
    render <
    Slug >
    Page({
      /* ... */
    });
  expect(html).toContain("admin-nav__link--active");
});
```

Run `bun run test:e2e <path>` and confirm RED. Commit:

```
test(<slug>): add red tests for the new <slug> page
```

### 2 · Green — implement

**JSON viewer flavour** — single controller method:

```typescript
@Get("<slug>")
list(
  @Headers("accept") accept: string | undefined,
  @Query("format") format: string | undefined,
  @Res() res: Response,
): void {
  const data = this.gather<Slug>Data();
  if (devWantsJson(accept, format)) {
    res.type("application/json").send(JSON.stringify(data));
    return;
  }
  res.type("text/html; charset=utf-8").send(
    renderJsonViewerPage({
      title: "<Title>",
      currentNav: "<slug>",
      value: data,
      rawJsonHref: "/<slug>?format=json",
    }),
  );
}
```

Make sure `devWantsJson` exists at the bottom of the controller file.
If not, copy the helper from `dev-hub.controller.ts`.

**Custom flavour** — three steps:

1. Write `src/core/dx/<slug>-ui.ts`:

   ```typescript
   import { renderAdminLayout } from "./admin-layout.js";

   export interface <Slug>PageInput { /* typed input */ }

   export function render<Slug>Page(input: <Slug>PageInput): string {
     const body = `<style>...</style><div class="admin-card">...</div>`;
     return renderAdminLayout({
       title: "<Title>",
       subtitle: "Optional sub-text",
       currentNav: "<slug>",
       body,
     });
   }

   function escapeHtml(input: string): string { /* five-char table */ }
   ```

2. Wire the controller method:

   ```typescript
   @Get("<slug>")
   @Header("content-type", "text/html; charset=utf-8")
   <slug>Page(): string {
     this.assertDev();   // if dev-only
     return render<Slug>Page({ /* ... */ });
   }
   ```

3. Sidebar entry in `src/core/dx/clients/layout/nav.ts` (`NAV_SECTIONS` + `SPA_ROUTES`):

   ```typescript
   {
     id: "<slug>",
     label: "<Title>",
     href: "/<slug>",
     icon: ICON_<MATCHING_NAME>,
   }
   ```

   If you need a new icon: add an `ICON_<NAME>` constant at the bottom
   of the file with a 16x16 SVG `<path>` (single-colour, stroke-width 2).

### 3 · Tenant-exemption (if public)

If the page is dev-only or public, add the prefix to
`src/core/multi-tenancy/tenant-guard.ts`:

```typescript
const EXEMPT_PREFIXES = ["/health/", ..., "/<slug>/"];
// or
const EXEMPT_EXACT = new Set(["/", ..., "/<slug>"]);
```

Update the test in `tests/tenant-guard.e2e-spec.ts`. Without this,
the page returns 400 `CORE_VALIDATION` "Tenant Header Required".

### 4 · Six gates

```bash
bun run lint && \
bun run format && \
bun run test:types && \
bun run test:unit && \
bun run test:e2e && \
bun run test:coverage && \
bun run build
```

Common failures:

- **Lint/format**: `bun run lint:fix && bun run format:fix`
- **Coverage drops**: `*-ui.ts` files are pre-excluded — if your
  custom-flavour renderer is small, the story test should be enough.
  Add coverage to any sibling planner you wrote.
- **Tenant-guard test failing**: re-add the new path to `EXEMPT_*`.

### 5 · Live verify

State to the user:

> Wired the `<slug>` page. Open `http://localhost:3000/<slug>` in the
> browser. It should appear in the sidebar under `<section>` with the
> active highlight. Tenant-exemption: yes/no.

If it's the json-viewer flavour, also test:

- `curl -H "Accept: application/json" http://localhost:3000/<slug>`
  → returns raw JSON
- `curl http://localhost:3000/<slug>?format=json` → returns raw JSON

### 6 · Commit

```
feat(<slug>): add /<slug> page with <flavour> layout

- controller method with content-negotiation
- sidebar entry under <section> with <icon> icon
- tenant-exemption (or n/a)
- story test pinning structure + XSS escape
```

## Don't

- **Don't roll your own `<html>`/`<head>`** — always go through `renderAdminLayout`.
- **Don't skip the XSS test** — every renderer needs one.
- **Don't hard-code colours** — use the CSS variables from `clients/styles/tokens.css`.
- **Don't add functional logic to `*-ui.ts`** — those are coverage-excluded as glue. Put logic in a sibling planner that gets full coverage.
- **Don't forget the sidebar entry** — without it, the page is unreachable from navigation.
- **Don't forget to gate dev-only pages with `assertDev()`** — otherwise they leak in production.
