# Test-Run Plan — Multi-Tenant Todo on `--next` template

> **You are the agent.** Read this once, then start at "Setup". Discover
> the workspace through its own docs. Your confusion is the signal we
> are testing for.
>
> **Do NOT** look at `~/Projekte/Intern/nest-server-reload/` (the template
> repo) or `~/Projekte/Intern/npm-packages/cli/` (the scaffolding CLI).
> They are off-limits for this run — going in cold is the whole point.

## Mission

The lenne.tech CLI's `--next` flag scaffolds a fullstack project from
the new `nest-base` template (Bun + Prisma + Postgres + Better-Auth).
We need to know whether a real developer can take that scaffold and
ship a non-trivial multi-tenant feature without help.

You will:

1. Initialise a fresh project with the CLI in the **current working
   directory** (no `cd` outside it).
2. Bring up the dev environment.
3. Build a **multi-tenant Todo app** end-to-end (backend + frontend).
4. Log every friction point in a structured friction log at `./friction.md`.

The friction log is the deliverable. The Todo app is the vehicle.

## What's already fixed (do NOT re-report these)

These are confirmed-shipped at the time of writing. If any of them
shows up again, that's a regression — flag it loudly.

- Custom Postgres image with `pg_uuidv7` + `postgis` baked in
  (`docker compose up -d postgres` just works).
- Init-migration for the core schema (Tenant / User / TenantMember /
  Role / Policy / etc).
- `prisma.config.ts` reads `DATABASE_URL` from env (via `dotenv/config`).
- PostGIS migrations are feature-gated (only materialise when
  `FEATURE_GEO_ENABLED=true`).
- `bun run reset` uses `pg`-based DROP SCHEMA (no Prisma 7 AI-agent gate).
- `lt fullstack init --next` writes a fresh root README, CLAUDE.md, and
  `.claude/QUICKSTART.md` (no stale MongoDB/GraphQL content).
- "Hint: Non-interactive mode" warning skipped when `--noConfirm`.
- `docker-compose.yml` has no hard-coded `name:` or `container_name:`
  (each workspace gets its own Compose namespace + volumes).

## Setup

You are already in your working directory. Don't `cd` outside it.

```bash
lt fullstack init --name my-next-fs --frontend nuxt --next --noConfirm
cd my-next-fs
```

From here on, treat `my-next-fs` as the project root and follow its
own README / `CLAUDE.md` / `.claude/QUICKSTART.md` to bring it up. Do
**not** consult anything outside this workspace dir. If a step isn't in
the project's own docs, that's a friction-log entry.

## Domain — Multi-Tenant Todo

A small but realistic SaaS shape. Three resources:

### `Tenant`

- `id`, `name`, `slug`, `createdAt`, `deletedAt?`
- A user belongs to one or more tenants via `TenantMember` (already
  in the template — reuse, don't recreate).

### `User` (already in the template)

- Reuse Better-Auth's `User`. Don't shadow it.

### `Todo`

- `id` (UUID v7), `tenantId`, `createdById` (User), `title`,
  `description?`, `status` (`open` | `in_progress` | `done`),
  `dueAt?`, `createdAt`, `updatedAt`, `deletedAt?`

### Isolation rules

- A todo always belongs to exactly one tenant.
- A user can only see / mutate todos of tenants they are a member of.
- The template's permission model (CASL + DB rules) plus its tenant
  isolation (RLS) should give you both layers — your job is to wire
  the resource into the existing machinery, **not** to reinvent it.

### Acceptance criteria — backend

- `POST /v1/todos` — create (returns 201, validates input, sets
  `tenantId` from request context, sets `createdById` from session).
- `GET /v1/todos` — list, paginated (page/limit), filtered by status,
  ordered by `-createdAt` by default. Returns only the active tenant's
  todos.
- `GET /v1/todos/:id` — read one. 404 if it belongs to a different
  tenant (not 403 — leak prevention).
- `PATCH /v1/todos/:id` — update. Honours `If-Match`/`ETag` if the
  template provides it; otherwise note in the friction log.
- `DELETE /v1/todos/:id` — soft delete (`deletedAt`). Hard delete is
  admin-only.
- All mutations emit an audit log entry.
- Member of tenant A cannot see, list, read, update, or delete todos
  of tenant B — verified by an e2e test.
- An anonymous request gets `401`, not `403`.

### Acceptance criteria — frontend (Nuxt)

- `/login` and `/register` work end-to-end with Better-Auth.
- After login, `/tenants` shows the user's tenant memberships and lets
  them switch the active tenant.
- `/todos` is the main view: list (status filter, pagination), create
  form, per-row "edit / mark done / delete" actions.
- Switching tenant in the header changes which todos are visible.
- All forms use the project's validation conventions (Zod / Valibot —
  whichever the template enforces — discover it).
- Loading / empty / error states are visible.

### Tests

Follow the project's TDD discipline:

- **Backend** — story tests in `tests/stories/<feature>.story.test.ts`
  (RED first), e2e specs in `tests/<feature>.e2e-spec.ts` for HTTP-layer
  permission / tenant-isolation cases.
- **Frontend** — Playwright / e2e for the golden paths (register →
  login → create todo → switch tenant).
- Six gates green before committing each cycle.

## Friction Log — `./friction.md`

Maintain `./friction.md` (relative to the workspace root, NOT inside
`my-next-fs/`) and append entries **as you hit them**. One friction
per entry. No batching at the end. The log is the primary deliverable
— keep it current even when you're in flow.

### Entry format

```markdown
### YYYY-MM-DDThh:mm · <area> · <one-line summary>

- **Phase:** setup | backend | frontend | tests | docs | tooling
- **Severity:** blocker | high | medium | low | nit
- **Type:** doc-gap | bug | surprise | DX | missing-feature | typo
- **What I expected:** <one sentence>
- **What happened:** <one sentence — include exact error / output if any>
- **Where I was:** <file path / URL / step>
- **What I did to unstick myself:** <what worked, or "blocked, moved on">
- **Suggested fix:** <one line — doc edit, code change, both, or "discuss">
- **Belongs to:** template-repo | test-project | unclear
```

### Severity heuristic

- **blocker** — can't proceed without help / fix
- **high** — wasted >15 min figuring out, would block 80 % of devs
- **medium** — cost some time, would slow a real dev down
- **low** — noticed it, didn't slow me down, but worth noting
- **nit** — typo / wording / cosmetic

### What absolutely must be logged

- Any time the README / `CLAUDE.md` / `.claude/QUICKSTART.md` / a skill
  file says something the actual code or commands don't deliver.
- Any time you reach for a convention / file / command that you
  expected to exist and didn't.
- Any time the template's tooling fails (`bun run setup`, `bun run dev`,
  `prepare:schema`, `sync:to-template`, etc.).
- Any time you needed to fall back to outside knowledge (this prompt,
  general experience, training data) instead of the project's docs.
- Any time a code convention contradicts what the docs claim.

## PR flow back to the template

When you fix something in `my-next-fs/src/core/` or `my-next-fs/docs/`
that should benefit every consumer, route it back upstream — don't
just leave it in the test project:

1. Make the fix in `my-next-fs/src/core/<…>` (or `docs/<…>`).
2. Run `bun run sync:to-template` from inside `my-next-fs/`.
3. Read the resulting patch in `my-next-fs/reports/sync-to-template.patch`
   — verify it's only the intended change, no drift.
4. Use the project's `/upstream-pr` slash command (or the
   `contributing-upstream` skill) to open a PR against
   `lenneTech/nest-base`.
5. Mark the friction-log entry with the PR URL.

**Domain code stays in the test project.** The Todo entity, its DTOs,
its frontend pages, its modules — none of it flows upstream. Only
generic capability gaps + doc fixes do.

## Don'ts

- Don't read `~/Projekte/Intern/nest-server-reload/` or
  `~/Projekte/Intern/npm-packages/cli/`. The template's internal docs
  are not part of a fresh consumer's experience.
- Don't ask the human for help on something the docs _should_ cover —
  log it as a friction entry and try to unstick yourself first.
- Don't skip writing a story test before code. The template enforces
  this and we want to test that it actually scales to real domain
  features.
- Don't bypass the six gates with `--no-verify` / `it.skip` / `--force`.
  If a gate breaks, that's a friction entry.
- Don't fix random unrelated things you spot in the template. Stay on
  the Todo mission — the friction log captures everything else for
  later.

## When you're done

Stop when:

- All acceptance criteria are green (manual + automated), OR
- You hit a blocker that requires a human decision, OR
- The friction log has so many entries that going further is just
  noise (we have enough signal to act on).

Final report at the top of `./friction.md` under a `## Final Report`
heading:

1. **Mission status:** done / partial / blocked, with which acceptance
   criteria are green.
2. **Friction summary:** counts by severity + type, top-5 most painful
   entries with one-line summaries.
3. **PRs opened upstream:** list with URLs.
4. **Recommended next moves:** 3–5 bullet points for the human.
