# Email Outbox Admin — Hub Page

**Route:** `/hub/email-outbox`  
**Issue:** #91  
**Backend path:** `src/core/email/email-outbox-admin.controller.ts`  
**Frontend path:** `src/core/dx/clients/pages/EmailOutboxPage.tsx`

---

## Overview

The Email Outbox admin page lets operators inspect and act on
`email_outbox` rows — the at-least-once delivery queue that backs
`EmailService.sendTemplate({…}, { mode: "outbox" })`.

The page is accessible at `/hub/email-outbox` and requires the
`manage:EmailOutboxAdmin` CASL permission (Administrator role grants
this via `manage all`).

---

## Backend API

All endpoints are mounted under `/hub/admin/email-outbox/` and
require `@Can('manage', 'EmailOutboxAdmin')`.

### `GET /hub/admin/email-outbox/list.json`

Returns a paginated list of outbox rows with optional filters.

**Query parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `status` | `pending \| sent \| dead-letter \| cancelled` | Filter by status |
| `recipient` | string | Substring filter on `payload.to` |
| `template` | string | Exact match on `payload.template` |
| `dateFrom` | ISO 8601 | `createdAt >= dateFrom` |
| `dateTo` | ISO 8601 | `createdAt <= dateTo` |
| `sortBy` | `time \| attempts` | Sort order (default: newest first) |
| `cursor` | opaque | Cursor for next-page navigation |
| `limit` | 1–200 | Page size (default: 50) |

**Response:**

```json
{
  "items": [OutboxRecordDto],
  "nextCursor": "optional-opaque-string",
  "total": 42
}
```

### `GET /hub/admin/email-outbox/:id.json`

Returns full record detail including the raw payload (template vars,
recipient, locale).

### `POST /hub/admin/email-outbox/:id/retry`

Resets `attemptCount = 0`, `nextAttemptAt = null`, `status = pending`
so the worker picks the record up on the next tick.

Forbidden when `status = sent | cancelled`.

### `POST /hub/admin/email-outbox/:id/cancel`

Sets `status = cancelled`. The worker never processes cancelled rows.

Forbidden when `status = sent | cancelled`.

### `POST /hub/admin/email-outbox/test-send`

Fires a test email through the outbox for end-to-end validation.

**Body:**

```json
{
  "template": "welcome",
  "locale": "en",
  "recipient": "operator@example.com",
  "vars": { "name": "Alice" }
}
```

**Response:** `{ "id": "<outbox-uuid>" }` — the new outbox row id.

---

## State transitions

```
pending ──► sent          (worker delivered)
pending ──► dead-letter   (worker exhausted maxAttempts)
pending ──► cancelled     (admin cancel action)

dead-letter ──► pending   (admin retry action)
dead-letter ──► cancelled (admin cancel action)

sent ──► [terminal]       (no transitions allowed)
cancelled ──► [terminal]  (no transitions allowed)
```

The transition logic lives in
`src/core/email/email-outbox-action-planner.ts` — a pure function
with no DB dependency, fully covered by story tests in
`tests/stories/email-outbox-admin-planner.story.test.ts`.

---

## Frontend features

- **List view** — status badges, recipient, template, attempt count,
  next-attempt-at, created-at. Clickable rows navigate to detail.
- **30s auto-refresh** — `refetchInterval: 30_000` keeps the list
  current without manual reload.
- **Filter bar** — status dropdown, recipient substring input, sortBy
  selector.
- **Detail panel** with 4 tabs:
  - **Overview** — all fields as a definition list.
  - **Vars** — raw JSON payload (template options + recipient).
  - **Preview** — iframe (`sandbox=""`) rendering the template via
    the existing email-preview endpoint.
  - **Attempts** — attempt count, last error, timestamps.
- **Action buttons** — Retry, Cancel (disabled when forbidden by
  state machine).
- **Test-send modal** — sends a test email through the outbox.

---

## Security

Routes are gated by `@Can('manage', 'EmailOutboxAdmin')`.  
The `/hub/admin/` prefix is also in the hub allowlist (404 in
production outside `NODE_ENV=development`).

The iframe preview uses `sandbox=""` to prevent rendered email
content from executing scripts or navigating.

---

## Adding the permission to a role

In the admin permissions UI or via a seed script:

```ts
await prisma.permission.create({
  data: {
    policyId: adminPolicyId,
    resource: "EmailOutboxAdmin",
    action: "MANAGE",  // maps to CASL 'manage'
    fields: [],
  },
});
```
