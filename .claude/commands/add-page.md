---
description: Add a new Hub or admin page to the React 19 + shadcn/ui SPA shell (JSON viewer wrap or custom layout).
allowed-tools:
  - Read
  - Edit
  - Write
  - Bash
  - Grep
  - Glob
---

# /add-page

Adds a new page that lives in the Hub or admin sidebar, served by
the shared React 19 SPA at `src/core/dx/clients/`. Two flavours:

- **JSON viewer wrap** — for endpoints that return structured data
  (errors catalog, OpenAPI spec, parsed PostgREST query). The React
  page mounts `<JsonViewer>` over the JSON sidecar; the controller
  does content-negotiation between `text/html` (returns the SPA
  shell) and `application/json` (raw payload for SDKs).
- **Custom layout** — for pages with their own UI (coverage report,
  feature toggles, webhook inspector). Compose shadcn/ui primitives
  (`Card`, `Button`, `Badge`, `Tabs`, `Table`, `Dialog`, `Sheet`,
  `Switch`, `Input`, `Select`, …) under `<AdminShell>` plus Tailwind
  4 utility classes that resolve through the `@theme` bridge to the
  brand-aware tokens.

Read [`.claude/skills/extending-hub.md`](../skills/extending-hub.md)
first — it is the canonical guide. This command sequences the steps
under TDD.

## Arguments

```
/add-page <slug> "<title>" [<flavour>]
```

- **`<slug>`** — kebab-case URL fragment, e.g. `widgets` for `/hub/widgets`.
- **`<title>`** — display name, e.g. "Widget Inspector".
- **`<flavour>`** — `json-viewer` or `custom`. Default: ask the user.

If the page lives under `/admin/` instead of `/hub/`, prefix the slug
with `admin/` (e.g. `admin/orders`).

## Workflow

### 0 · Confirm before any edit

Echo the plan back to the user:

> I'll add a `<slug>` page titled "`<title>`" using the `<flavour>`
> pattern. It'll appear in the sidebar under `<section>` (Übersicht /
> API & Docs / Admin). Tenant-exempt: yes/no. Sound right?

Get explicit confirmation. Pin down: which sidebar section, which
icon (reuse an existing lucide-react icon from
`clients/layout/icons.tsx` or add a new one), tenant-exemption (yes
for public/dev, no for tenant-scoped business routes).

### 1 · Red — write the failing tests first

Add `<slug>` to the route ↔ sidebar ↔ JSON-endpoint contract test
first:

```typescript
// tests/stories/dev-portal-pages.story.test.ts
expectedRoutes.push("/<slug>");          // SPA route
expectedJsonEndpoints.push("/<slug>.json"); // JSON sidecar (custom flavour only)
expectedSidebarItems.push({ id: "<slug>", href: "/<slug>", label: "<Title>" });
```

For **json-viewer** flavour, write a small `tests/<slug>.e2e-spec.ts`:

```typescript
it("returns the SPA shell for browsers", async () => {
  const res = await request(app.getHttpServer())
    .get("/<slug>")
    .set("Accept", "text/html");
  expect(res.headers["content-type"]).toMatch(/text\/html/);
  expect(res.text).toContain('<div id="root"></div>');
  expect(res.text).toContain("<Title> — nest-server");
});

it("returns JSON when Accept: application/json", async () => {
  const res = await request(app.getHttpServer())
    .get("/<slug>")
    .set("Accept", "application/json");
  expect(res.headers["content-type"]).toMatch(/application\/json/);
});

it("returns JSON when ?format=json overrides Accept", async () => {
  const res = await request(app.getHttpServer())
    .get("/<slug>?format=json")
    .set("Accept", "text/html");
  expect(res.headers["content-type"]).toMatch(/application\/json/);
});
```

For **custom** flavour, write a story test that pins the JSON sidecar
shape and any pure planner you extract (the React page itself is
coverage-excluded — exercise it visually):

```typescript
// tests/stories/<slug>.story.test.ts
it("gathers <slug> data with the expected shape", () => {
  const data = gather<Slug>Data({ /* fixture */ });
  expect(data).toMatchObject({ /* … */ });
});

it("escapes user-controlled values in /<slug>.json", async () => {
  // The JSON sidecar must round-trip safely through JSON.stringify.
});
```

Run `bun run test:e2e <path>` (or `test:unit` for story tests) and
confirm RED. Commit:

```
test(<slug>): add red tests for the new <slug> page
```

### 2 · Green — implement

**JSON viewer flavour** — controller does content-negotiation, React
page wraps `<JsonViewer>`.

Controller method (in `src/core/<domain>/<domain>.controller.ts`):

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
    renderDevPortalShell(buildDevPortalShellInput({ title: "<Title>" })),
  );
}
```

Make sure `devWantsJson` exists at the bottom of the controller file.
If not, copy the helper from `dev-hub.controller.ts`.

React page (`src/core/dx/clients/pages/<Slug>Page.tsx`):

```tsx
import { useQuery } from "@tanstack/react-query";
import { AdminShell } from "../layout/AdminShell.js";
import { JsonViewer } from "../components/JsonViewer.js";
import { fetchJson } from "../lib/fetchJson.js";
import { PageError, PageLoading } from "../components/PageState.js";

export default function <Slug>Page(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ["<slug>"],
    queryFn: () => fetchJson("/<slug>?format=json"),
  });
  return (
    <AdminShell title="<Title>" subtitle="…" currentNav="<slug>">
      {isLoading ? <PageLoading /> :
       error ? <PageError error={error} /> :
       <JsonViewer value={data} rawJsonHref="/<slug>?format=json" />}
    </AdminShell>
  );
}
```

**Custom flavour** — three pieces:

1. **JSON sidecar route** in `dev-hub.controller.ts` (for `/hub/*`)
   or `admin-spa.controller.ts` (for `/admin/*`):

   ```typescript
   @Get("<slug>")
   @Header("content-type", "text/html; charset=utf-8")
   <slug>Page(): string {
     this.assertDev();
     return renderDevPortalShell(buildDevPortalShellInput({ title: "<Title>" }));
   }

   @Get("<slug>.json")
   <slug>Json(): { /* shape */ } {
     this.assertDev();
     return this.gather<Slug>Data();
   }
   ```

2. **React page** (`src/core/dx/clients/pages/<Slug>Page.tsx`).
   Compose the body from shadcn/ui primitives under
   `clients/components/ui/` (`Card`, `Badge`, `Button`, `Input`,
   `Switch`, `Tabs`, `Dialog`, `Sheet`, `Table`, …) plus Tailwind 4
   utility classes (`bg-surface-2`, `text-fg-muted`, `border-line`,
   `text-accent`, `bg-ok/15 text-ok`, `grid grid-cols-2 gap-4`, …).
   Reuse `PageLoading`, `PageError`, `PageEmpty`, `StatTile` from
   `components/PageState.tsx` for the standard states.

3. **Sidebar entry** in `src/core/dx/clients/layout/nav.ts`
   (`NAV_SECTIONS` + `SPA_ROUTES`):

   ```typescript
   {
     id: "<slug>",
     label: "<Title>",
     href: "/<slug>",
     icon: ICON_<MATCHING_NAME>,
   }
   ```

   If you need a new icon: pick one from
   [`lucide-react`](https://lucide.dev/icons) and add an
   `ICON_<NAME>` constant at the bottom of
   `clients/layout/icons.tsx`.

4. **Route table** in `src/core/dx/clients/App.tsx`:

   ```tsx
   const <Slug>Page = lazy(() => import("./pages/<Slug>Page.js"));
   …
   <Route path="/<slug>" element={<<Slug>Page />} />
   ```

### 3 · Tenant-exemption (if public)

If the page is dev-only or public, add the prefix to
`src/core/multi-tenancy/tenant-guard.ts`:

```typescript
const EXEMPT_PREFIXES = ["/health/", ..., "/<slug>/"];
// or
const EXEMPT_EXACT = new Set(["/", ..., "/<slug>"]);
```

If JWT/session must be skipped, do the same in
`src/core/auth/jwt-middleware.ts` (`PUBLIC_EXACT` /
`PUBLIC_PREFIXES`). Update the guard tests accordingly. Without
this, the page returns 400 `CORE_VALIDATION` "Tenant Header Required"
or 401 from the JWT middleware.

### 4 · Six gates

```bash
bun run lint && \
bun run test:unit && \
bun run test:e2e && \
bun run test:types && \
bun run test:coverage && \
bun run build
```

Common failures:

- **Lint/format**: `bun run lint:fix && bun run format:fix`
- **Coverage drops**: `clients/` is coverage-excluded — if your
  custom-flavour page extracts a planner, give that planner its own
  story test.
- **Tenant-guard test failing**: re-add the new path to `EXEMPT_*`.
- **dev-portal-pages.story.test.ts failing**: you forgot to add the
  route ↔ sidebar ↔ JSON-endpoint triple. Re-read step 1.

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

- controller method with content-negotiation (and JSON sidecar for custom flavour)
- React page under src/core/dx/clients/pages/, composed from shadcn primitives
- sidebar entry under <section> with <icon> icon
- tenant-exemption (or n/a)
- story test pinning the route ↔ sidebar ↔ JSON contract
```

## Don't

- **Don't roll your own server-side renderer.** The legacy `*-ui.ts`
  HTML path is gone. Every page is a React component under
  `src/core/dx/clients/pages/`.
- **Don't bypass `<AdminShell>`.** The shell owns the sidebar +
  header + layout grid; a page that renders without it will look
  detached.
- **Don't hard-code colours.** Use Tailwind utilities that resolve
  through `@theme` (`bg-background`, `text-fg-muted`, `border-line`,
  `text-accent`, …) so the brand-loader (Issue #5) can override
  them.
- **Don't introduce native HTML form inputs in net-new pages.** Use
  shadcn primitives (`Input`, `Select`, `Switch`, `Checkbox`,
  `Textarea`, `RadioGroup`) so a11y, keyboard navigation, and dark-
  mode focus rings come for free.
- **Don't add functional logic to `clients/`.** It's coverage-
  excluded. Logic lives in a sibling `src/core/dx/` planner with its
  own story test.
- **Don't forget the sidebar entry.** Without it, the page is
  unreachable from navigation.
- **Don't forget to gate dev-only pages with `assertDev()`.**
  Otherwise they leak in production.
