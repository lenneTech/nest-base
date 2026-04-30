# Debugging Permission Denials

When the API returns `403 forbidden` (or `CanGuard` throws
`ForbiddenException`), this skill is the standard diagnostic path.
It chains the tools the project already ships into a deterministic
sequence so you stop guessing and start verifying.

## When to reach for this skill

- A user reports "I get 403 on POST /resources"
- A test that should pass fails with `ForbiddenException`
- A new endpoint with `@Can('action', 'Subject')` doesn't pass the
  ability check for a user who _should_ be allowed
- You are auditing a permission setup and need to know: "for this
  user, what can they actually do?"

## What you'll need

- The dev server running (`bun run dev`) — `/dev/logs` and
  `/admin/permissions/test` are dev-only routes
- The user-id and tenant-id of the affected user (from the request
  log, the auth-cookie, or the test fixture)

## The 5-step diagnostic path

### 1 · Find the actual reason in the server log

The user-facing error message is intentionally generic
(`"forbidden"` — see `wiring-permissions.md`). The real reason is in
the structured log:

```bash
curl -s 'http://localhost:3000/dev/logs.json?level=warn&q=forbidden' \
  | jq '.records[] | { ts, msg, requestId }'
```

Or in the browser at `/dev/logs` filter by `forbidden`. Each denial
emits a line like `forbidden: read:Project denied`. That tells you
the `(action, subject)` pair the guard checked.

If you see `forbidden: no ability for ...`, the request never had an
authenticated user — check the auth middleware (cookie, token), not
the permission rules.

### 2 · Identify the user and tenant from the request

Match the `requestId` from step 1 to the request log entry to find
`userId` + `tenantId`. Or — if testing — read them from the fixture.

### 3 · Verify the user's effective ability

Open `/admin/permissions/test` and submit:

- User Id: from step 2
- Tenant Id: from step 2
- Action: from step 1
- Subject: from step 1

The page renders the resolved CASL `Ability`: every rule that
contributes, the `inverted` / `conditions` / `fields` for each, and
the final allow/deny decision. The matched-rule list tells you
exactly which DB rule (or default) drove the outcome.

If the result is **denied** and you expected **allowed**:

- No rule matched → the user simply has no permission for that
  `(action, subject)`. Add a rule (see `wiring-permissions.md`).
- A `cannot()` rule matched → some inverted rule is taking precedence.
  CASL applies `cannot` after `can`, so an `inverted: true` rule
  shadows a permissive one. Find it in the rule list, decide whether
  to remove it, narrow its conditions, or escalate the user's role.
- A rule matched but `conditions` excluded the record → the user
  has the `(action, subject)` but not on this _specific_ record.
  E.g. `can('update', 'Project', { ownerId: '$userId' })` excludes
  projects the user doesn't own. Check the actual record's fields.

If the result is **allowed** but the request still 403s:

- The `CanGuard` runs _before_ the handler; the rule may allow but
  the controller's `@Restricted()` (legacy) or `@Roles()` decorator
  may add a second gate. Check the route definition.
- Field-level `fields: []` array on a rule = "no field restriction"
  in this codebase (CASL cannot represent "deny every field" in a
  single rule; see `OPEN_QUESTIONS.md`).

### 4 · Inspect the underlying DB permission rules

`/admin/permissions/test` reads from `permission.service.ts` which
resolves rules from the `Permission` and `PermissionAssignment`
tables. Run a quick query in Prisma Studio to see the raw data:

- `Permission` rows where `subject = '<your subject>'`
- `PermissionAssignment` rows linking the user (or their roles) to
  those permissions

If the assignment is missing, the user was never granted the
permission — fix the seed, fix the role-grant flow, or fix the
test fixture.

### 5 · Reproduce in a story test

Once you've confirmed the cause, write a regression test in
`tests/stories/<feature>.story.test.ts`:

```typescript
describe("Story · <feature>", () => {
  it("denies <action> on <subject> when <condition>", async () => {
    const ability = buildAbility([{ action: "read", subject: "Project" }]);
    expect(ability.can("update", "Project")).toBe(false);
  });

  it("allows <action> when <other condition>", async () => {
    const ability = buildAbility([
      { action: "read", subject: "Project" },
      { action: "update", subject: "Project", conditions: { ownerId: "u-1" } },
    ]);
    expect(ability.can("update", "Project", { ownerId: "u-1" })).toBe(true);
  });
});
```

Red → fix the rule → green. The test prevents the same denial from
silently coming back.

## Common red herrings

- **"It worked locally"** — your local seed gave the user the
  permission; CI's seed doesn't. Always check the seed, not just the
  request flow.
- **"The Ability says allow but I still get 403"** — check whether
  the route also uses the legacy `@Restricted()` / `@Roles()`
  decorators. They are NOT supposed to ship in nest-base (see
  `docs/architecture.md` "Out of scope"), but a downstream project may
  have re-introduced them.
- **"It works for tenant A but not B"** — RLS blocked the underlying
  query, not the permission. Symptom is usually empty result, not
  403 — but a `findOrThrow` turns "row not visible" into
  `NotFoundException`, which a poorly-shaped controller can convert
  to 403. Check `/dev/logs` for the actual exception class.
- **"Permission added but still denied"** — caching. Restart the dev
  server (`.env` watcher catches edits but not DB changes). The
  PermissionService has no cache today, so this is rare, but worth
  checking if you wired one.

## Don't

- Don't just add a permission to make the test pass — first confirm
  _why_ the user should be allowed; the missing rule is a domain
  decision.
- Don't echo `(action, subject)` back to the client to "give the user
  better errors". The generic message is intentional (information
  disclosure prevention — see `can.guard.ts:64`).
- Don't loop guessing in `permissions.service.ts`; if the
  `/admin/permissions/test` page agrees with the guard, the issue is
  upstream (DB rules, auth context, or a non-CASL gate).

## Related skills

- `wiring-permissions.md` — how to add a new permission gate
- `understanding-the-architecture.md` — the 3-layer permission model
  (CASL ability + DB rules + securityCheck)
