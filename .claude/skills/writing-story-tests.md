# Writing Story Tests

Story tests are _the_ TDD vehicle for nest-base. One file per behaviour
surface; the test exists **before** the source. This skill is the
practical pattern reference — copy from here when you start a new
story.

---

## Where they live

```
tests/
├── stories/
│   └── <feature>.story.test.ts   ← bun run test:e2e picks these up
├── unit/                          ← bun run test:unit (pure-function-only)
├── types/                         ← bun run test:types (tsc compile-time)
└── <feature>.e2e-spec.ts          ← bun run test:e2e (HTTP layer)
```

`bun run test:e2e` matches `e2e-spec` or `stories` in the path. Story
tests should NOT boot the full NestJS app — they exercise pure
functions / planners / renderers. If you need the HTTP layer, write an
`e2e-spec.ts` instead.

---

## The shape

```typescript
// tests/stories/widgets.story.test.ts
import { describe, expect, it } from "vitest";

import { planWidget } from "../../src/core/widgets/widget-planner.js";

describe("Story · Widgets", () => {
  describe("default behaviour", () => {
    it("returns an empty plan when no input", () => {
      expect(planWidget({ items: [] })).toEqual({ size: 0, items: [] });
    });

    it("preserves item order", () => {
      const out = planWidget({ items: ["a", "b", "c"] });
      expect(out.items).toEqual(["a", "b", "c"]);
    });
  });

  describe("validation", () => {
    it("throws on negative size", () => {
      expect(() => planWidget({ items: [], maxSize: -1 })).toThrow(/maxSize/);
    });
  });

  describe("XSS safety", () => {
    it("does not interpolate HTML from user input", () => {
      const out = renderWidgetHtml({ label: "<script>alert(1)</script>" });
      expect(out).not.toContain("<script>");
      expect(out).toContain("&lt;script&gt;");
    });
  });
});
```

### Naming

- File: `<feature>.story.test.ts`. Kebab-case, ends in `.story.test.ts`.
- `describe`: `"Story · <Capitalised Feature>"` — the dot makes the
  test runner output read as a narrative.
- Sub-describes group by aspect (`"default behaviour"`, `"validation"`,
  `"XSS safety"`, `"edge cases"`).

---

## What story tests should assert

### For pure planners

- **Default values** — what happens when you pass `{}`?
- **Required-input errors** — empty arrays, missing fields, wrong types.
- **Invariants** — sort stability, idempotence, monotonicity.
- **Edge cases** — boundary numbers, single-item arrays, deeply nested
  structures.
- **Return-shape stability** — `toEqual({...})` for small structures,
  `toMatchObject({...})` when you only care about specific fields.

### For renderers

- **Structural** — does the HTML contain the expected key tags
  (`<title>`, `<h1>`, `<table data-foo="true">`)?
- **Slot content** — is the body slot inserted where expected?
- **Active state highlighting** — does `currentNav` highlight the
  right sidebar item?
- **XSS** — every renderer must have an XSS test. Pass HTML in user
  data; assert `toContain("&lt;script&gt;")` and
  `not.toContain("<script>alert")`.

### For controllers (e2e specs)

- **Status code + content type** — `expect(res.status).toBe(200)`
  - `expect(res.headers["content-type"]).toMatch(/application\/json/)`
- **Body shape** — `toMatchObject({...})` so extra fields don't break the test
- **Error paths** — at least one 4xx case per endpoint
- **Content negotiation** — if the route has both HTML and JSON,
  test both via Accept header

---

## Patterns we use repeatedly

### Test fixture builder

```typescript
function input(overrides: Partial<MyInput> = {}): MyInput {
  return {
    field1: "default",
    field2: 42,
    ...overrides,
  };
}

it("does X", () => {
  expect(planFoo(input({ field2: 99 }))).toBe("y");
});
```

### Per-test fakes

```typescript
function fakeStore(): Store & { records: Record[] } {
  const records: Record[] = [];
  return {
    records,
    async insert(record) { records.push(record); return record; },
  };
}

it("writes through the store", async () => {
  const store = fakeStore();
  await service.create(store, { ... });
  expect(store.records).toHaveLength(1);
});
```

Each story file owns its fakes — don't share between files. When a
fake genuinely deserves cross-file reuse, promote to `tests/lib/`.

### Time control

Never use `Date.now()` in pure planners. Take it as input:

```typescript
// in source
export function planRetry(input: { attempts: number; now: () => number }) { ... }

// in test
const fixedNow = () => 1_000_000;
expect(planRetry({ attempts: 3, now: fixedNow })).toEqual({...});
```

This is also why `Promise<void>` mock dates are unnecessary — you
inject a fake `now`.

### Asserting on HTML output

The escape-aware patterns:

```typescript
// quotes get HTML-escaped to &quot; — match accordingly
expect(html).toContain('class="foo">&quot;a&quot;');

// when you don't care about exact escaping
expect(html).toMatch(/admin-card__title/);
```

### Position-based assertions

To assert "X appears before Y" without brittle regex:

```typescript
const xIdx = html.indexOf("FieldX");
const yIdx = html.indexOf("FieldY");
expect(xIdx).toBeLessThan(yIdx);
expect(xIdx).toBeGreaterThan(0);
```

### Sidebar interference

If your renderer wraps in `renderAdminLayout`, the sidebar contains
labels that may collide with body content. Search inside the body:

```typescript
// "Audit" appears in the sidebar AND the audit row — search the table
const tableStart = html.indexOf('data-permission-report="true"');
const auditPos = html.indexOf("Audit", tableStart);
```

---

## Banned patterns

Per `tests/CLAUDE.md`:

- `it.skip(...)` / `xit(...)` — never. Fix the test or fix the code.
- `--no-verify` / `--force` on git — bypassing hooks is forbidden.
- Coverage drops — every commit must keep or raise the % numbers.
- `expect(...).resolves.toBeDefined()` — assert the actual shape,
  not "something resolved".
- Boot-the-whole-app for a planner test — story tests are pure,
  millisecond-scale. If you need NestJS, write an e2e-spec instead.

---

## TDD slice flow with story tests

```bash
# 1. Red: write the story, file imports a module that doesn't exist yet
vim tests/stories/widgets.story.test.ts
bun run test:e2e tests/stories/widgets.story.test.ts
# → ERR_MODULE_NOT_FOUND, that's the red

git add tests/stories/widgets.story.test.ts
git commit -m "test(widgets): add red tests for plan + render"

# 2. Green: write the source until the test passes
vim src/core/widgets/widget-planner.ts
vim src/core/widgets/widget-renderer.ts
bun run test:e2e tests/stories/widgets.story.test.ts
# → all green

# 3. Six gates
bun run lint && bun run format && bun run test:types && \
  bun run test:unit && bun run test:e2e && \
  bun run test:coverage && bun run build

# 4. Commit
git add src/core/widgets/
git commit -m "feat(widgets): planner + renderer for the widget surface"
```

---

## Phase-audit story tests

`tests/stories/phase-N-test-first-audit.story.test.ts` files exist as
regression guards — they assert that PLAN.md §32's mandated story
files are still on disk. If a future doc rewrite renames a story
file, the audit wakes up.

You don't write these — they're auto-managed by the slice-implementer.
If one fails because you renamed a story, update the audit assertion
in the same commit.

---

## When story tests aren't enough

Some surfaces require the HTTP layer:

- Controller decorators (`@Header`, `@Query`)
- Global filters/interceptors/guards
- Better-Auth handler mounting
- Tenant-isolation roundtrips

For those, write `tests/<feature>.e2e-spec.ts`:

```typescript
import { Test } from "@nestjs/testing";
import request from "supertest";

describe("GET /widgets", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 200 with JSON", async () => {
    const res = await request(app.getHttpServer()).get("/widgets");
    expect(res.status).toBe(200);
    expect(res.body.items).toBeInstanceOf(Array);
  });
});
```

Reach for e2e specs **only** when story tests can't express the
behaviour. They're slower (Postgres testcontainer boot), so prefer
the cheap path when possible.
