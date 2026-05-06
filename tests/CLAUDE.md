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

- `src/core/` — line coverage **≥ 80 %**
- `src/modules/` — line coverage **≥ 75 %**

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

## Shared-table isolation under parallel execution

E2E specs that touch tables shared with other parallel specs (e.g.
`audit_log`, `email_outbox`, `verifications`, `idempotency_records`,
`asset_variant_index`, `geocoding_cache`) MUST scope every read /
write / delete to a per-suite identifier — never `deleteMany({})`,
`findFirst()` / `findMany()` without a `where` clause, or
`updateMany({})` without a `where`.

Established patterns:

- **Per-suite tenant** — `const TENANT = crypto.randomUUID();` in
  the spec scope; every assertion filters `where: {tenantId: TENANT}`
  (audit-browser-data.e2e-spec.ts, audit-extension-prisma.e2e-spec.ts).
- **Per-suite key prefix** — `const PREFIX = \`<spec>-${crypto.randomUUID()}::\`;`with every key written through the spec carrying the prefix; queries
filter`where: {key: {startsWith: PREFIX}}` (idempotency-cleanup-cron.e2e-spec.ts).
- **Per-suite SUITE_TAG on payload fields** — for tables where the
  primary key is generated, scope through a domain-meaningful field
  (recipient email, identifier, idempotencyKey) prefixed with
  `${SUITE_TAG}-` (email-outbox-flow.e2e-spec.ts,
  email-outbox-prisma.e2e-spec.ts).

Why: vitest runs ~10 worker processes in parallel. Each spec
that boots `bootstrap()` fires every `OnModuleInit` cron in the app
including any `*CleanupCron` whose `runOnce()` issues a global
DELETE based on time / status. Specs that don't filter their own
queries see rows from concurrent specs AND have their seeded rows
swept by concurrent crons. The only stable contract is "OUR rows
under OUR tag" — assertions outside that boundary are flaky by
construction.

When a spec asserts a global counter (e.g. `storage.countPending()`
on a table-wide view), the assertion must be `>= 0` or `>= ourCount`
— never `=== N` — since concurrent specs contribute to the same
counter.

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

1. Pins `NODE_ENV=test` via `pinTestNodeEnv()` (the per-worker
   `setupFiles` entry pins it earlier still, before any user
   import — the duo is defence-in-depth against Bun's `.env`
   autoload).
2. Decides via the pure `planTestDatabaseStrategy()` planner whether
   to spawn an isolated Postgres testcontainer (`postgres:18-alpine`)
   or reuse an inherited URL.
3. Exposes the chosen `DATABASE_URL` to every test.
4. Tears the container down after the run.

### Test-DB strategy (env hygiene)

The default is **always testcontainer**. Bun auto-loads `.env`, so
without this rule a fresh consumer's dev `DATABASE_URL` would silently
route the suite at the dev DB and `bun run test:e2e` would drop rows
from `localhost:5434/<workspace>`. Two explicit overrides:

| Env var                   | Effect                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `TEST_DATABASE_URL=<url>` | Reuse the URL (CI service container, no opt-in needed).                               |
| `TEST_REUSE_DEV_DB=1`     | Reuse the inherited `DATABASE_URL` (DESTRUCTIVE — writes to / drops from the dev DB). |
| _none_                    | Spawn a fresh testcontainer; clear any inherited URL first.                           |

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
