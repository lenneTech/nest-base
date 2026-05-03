# CLAUDE.md — `tests/`

This folder is the test surface. Three kinds of tests live here, each
with its own conventions and `bun run` script.

## Layout

```
tests/
├── stories/              ← TDD story tests (one file per surface).
│   ├── *.story.test.ts   ← bun run test:e2e picks these up
├── unit/                 ← pure-function tests
│   └── *.spec.ts         ← bun run test:unit
├── types/                ← TypeScript compile-time tests
│   ├── tsconfig.json     ← strict, noEmit
│   └── *.type-test.ts    ← bun run test:types
├── lib/                  ← shared test infrastructure
├── *.e2e-spec.ts         ← end-to-end (HTTP layer); test:e2e
├── global-setup.ts       ← Vitest globalSetup (boots Postgres testcontainer)
└── k6/                   ← load + memory tests (separate runner)
```

`bun run test:e2e` matches files containing `e2e-spec` or `stories` in the
path. `bun run test:unit` matches files in `tests/unit/`.

## Story tests — the red-first workflow

Story tests are _the_ TDD vehicle. One file per behaviour surface; each
file defines a single `describe('Story · <name>', ...)` with nested
describes for sub-aspects.

A story test is RED before the source file even exists:

```typescript
// tests/stories/widgets.story.test.ts (red — module does not exist yet)
import { describe, expect, it } from "vitest";
import { WidgetService } from "../../src/core/widgets/widget.service.js";

describe("Story · Widgets", () => {
  it("creates a widget with the supplied name", async () => {
    const svc = new WidgetService(/* ... */);
    const widget = await svc.create({ name: "foo" });
    expect(widget.name).toBe("foo");
  });
});
```

Verify red with `bun run test:e2e tests/stories/widgets.story.test.ts`,
commit `test(widgets): add red tests for create()`, then write the
service until green.

## Story-test conventions

### Naming

`tests/stories/<feature>.story.test.ts`. The describe block uses
`Story · <Capitalised Feature>` so the test runner output reads as a
narrative.

### Per-test fakes / fixtures

Each story file owns its fakes. Don't share inter-file. A typical
pattern:

```typescript
function fakeStore(): Store & { records: Record[] } {
  const records: Record[] = [];
  return {
    records,
    async insert(record) {
      records.push(record);
      return record;
    },
    // …
  };
}
```

When fakes get genuinely useful across files (e.g. an HTTP client
stub, a clock helper), promote them to `tests/lib/`.

### Pure planners get pure tests

If the story is for a pure planner (`buildScalarConfig`,
`computeETag`, `planSyncFromTemplate`), the test takes inputs and
asserts outputs — no Postgres, no Docker, no NestJS app.

If the story needs the HTTP layer, it goes in `tests/<feature>.e2e-spec.ts`
instead.

### Coverage targets

- `src/core/` — line coverage **≥ 90 %**
- `src/modules/` — line coverage **≥ 80 %**

The `bun run test:coverage` gate fails CI below these. New code without
a story drags the average; the slice doesn't merge until it climbs back.

### Banned patterns

- `it.skip(...)`, `xit(...)` — never. If a test is breaking, fix the
  test or the code, don't park it.
- `--no-verify`, `--force` on git — never bypass the pre-commit / hook
  layer.
- Coverage drops — every commit must keep or raise the % numbers.
- `expect(...).resolves.toBeDefined()` and other assertion-of-nothing
  patterns. Assert the actual shape.

## E2E specs

`tests/<feature>.e2e-spec.ts` boot a real NestJS app via
`@nestjs/testing` and hit endpoints with `supertest`. They run against
the Postgres testcontainer that `global-setup.ts` starts.

Pattern:

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

  it("lists widgets for the authenticated user", async () => {
    const res = await request(app.getHttpServer())
      .get("/widgets")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toBeInstanceOf(Array);
  });
});
```

E2E specs are slower than story tests; reach for the story first
whenever the surface can be exercised without HTTP.

## Type tests

`tests/types/*.type-test.ts` use `tsc --noEmit` to assert TypeScript
shape — useful for ensuring generic inference, never-types, and discriminated-
union narrowing work as documented:

```typescript
import { expectTypeOf } from "expect-type";
import { foo } from "../../src/core/foo.js";

// Compile-time assertion only — runs as part of `bun run test:types`
expectTypeOf(foo({ x: 1 })).toMatchTypeOf<{ y: string }>();
```

## `tests/lib/fake-prisma.ts` — what's emulated, what isn't

The in-memory fake covers the slim-module call surface — `create`,
`findUnique`, `findMany`, `update`, `delete`, plus the new `count` and
`findMany({ skip, take })` after the friction-log #9 fix. Two
limitations to know about:

- `findUnique` ignores `select` / `include`. It returns the full row
  shape every time. If a service relies on `select` to drop columns
  (e.g. for an output-pipeline test), the assertion has to filter
  those columns itself — story tests can't depend on Prisma's
  projection semantics. Tracked for a future slice; not in scope for
  the current pagination/UUID fixes.
- `dbgenerated("uuid_generate_v7()")` runs server-side only — the
  fake auto-injects a `uuidV7()` when `data.id` is absent on
  `create`, so service code that omits `id` (the recommended
  pattern for new feature-gated schemas) round-trips correctly. See
  `tests/stories/fake-prisma-uuid-injection.story.test.ts`.

## global-setup.ts

`tests/global-setup.ts` is a Vitest globalSetup hook. It:

1. Sets `NODE_ENV=test`.
2. Starts a Postgres testcontainer (`postgres:18-alpine`) if
   `DATABASE_URL` isn't already set (CI passes one in).
3. Exposes `DATABASE_URL` to every test.
4. Tears the container down after the run.

If your test needs RustFS (file storage), use the
`buildRustFsContainerConfig` helper from `tests/lib/rustfs-container.ts`
and start a `GenericContainer` per test (or per file with a
`beforeAll`/`afterAll`).

## Don't add here

- Source code — that's `src/core/` or `src/modules/`.
- Documentation — `docs/`.
- Build scripts — `scripts/`.

## When you write a test

Remember the loop: **red first**. The test file exists _before_ the
source it tests. Verify red with `bun run test:e2e <path>` (or
`test:unit`), commit the red, then write the source until green. The
discipline is what keeps the coverage bar honest.
