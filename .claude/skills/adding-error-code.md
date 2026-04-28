# Adding an Error Code

How to register a new `APP_*` error code so it surfaces consistently
through RFC 7807 problem-details responses, the `/errors` i18n
endpoint, the OpenAPI doc, and the Audit-Browser.

## The two namespaces

| Prefix | Owner | Lives in |
|---|---|---|
| `CORE_*` | Template | `src/core/errors/error-code.ts` |
| `APP_*` | Project | `src/modules/<resource>/<resource>.errors.ts` (or wherever fits) |

Don't add `CORE_*` codes from a project — those ship with the
template. If you need a new core code, send a PR upstream.

## Registering an `APP_*` code

### 1. Define the code

Project-local — typically next to the service that throws it:

```typescript
// src/modules/projects/projects.errors.ts
import type { ErrorCodeDefinition } from '../../core/errors/error-code-registry.js';

export const APP_PROJECT_LIMIT_REACHED: ErrorCodeDefinition = {
  code: 'APP_PROJECT_LIMIT_REACHED',
  status: 409,
  messages: {
    en: {
      title: 'Project limit reached',
      detail: 'This tenant has reached its project quota of {{limit}}.',
    },
    de: {
      title: 'Projekt-Limit erreicht',
      detail: 'Dieser Tenant hat sein Projekt-Limit von {{limit}} erreicht.',
    },
  },
};
```

The format is mandated by the registry:

- `code` — `^[A-Z][A-Z0-9_]+$` (no lowercase, no leading digit)
- `status` — HTTP status (`100..599`)
- `messages.en` — required as fallback locale
- placeholders use `{{name}}` (resolved at runtime via `vars`)

### 2. Register at boot

In your project's bootstrap (e.g. `src/main.ts` or wherever the
template's `ErrorCodeRegistry` is instantiated):

```typescript
import { ErrorCodeRegistry } from '@/core/errors/error-code-registry.js';
import { APP_PROJECT_LIMIT_REACHED } from '@/modules/projects/projects.errors.js';

const registry = new ErrorCodeRegistry();
registry.register(APP_PROJECT_LIMIT_REACHED);
// register other APP_* codes …
```

The registry throws `ErrorCodeAlreadyRegisteredError` on a duplicate
— register-once at boot, not lazily per-request.

### 3. Wire into the OpenAPI doc

The OpenAPI components builder reads `coreCodes` + `appCodes`:

```typescript
import { CORE_ERROR_CODES } from '@/core/errors/error-code.js';
import { buildProblemDetailsOpenApiComponents } from '@/core/errors/openapi-problem-schemas.js';

const components = buildProblemDetailsOpenApiComponents({
  coreCodes: Object.values(CORE_ERROR_CODES),
  appCodes: registry.list().map((d) => d.code),
});

// merge into the Swagger document
```

Now the `code` enum on the OpenAPI `ProblemDetails` schema includes
your `APP_*` code — the generated SDK + Scalar UI both surface it.

### 4. Throw it

In the service:

```typescript
import { ProblemDetailsException } from '@/core/errors/problem-details.exception.js';
import { APP_PROJECT_LIMIT_REACHED } from './projects.errors.js';

if (count >= LIMIT) {
  throw new ProblemDetailsException(
    APP_PROJECT_LIMIT_REACHED.code,
    APP_PROJECT_LIMIT_REACHED.status,
    { limit: String(LIMIT) },   // ← interpolated into the detail message
  );
}
```

The exception filter reads the locale off the request (`Accept-Language`
or session preference), calls `registry.resolve(code, locale, vars)`,
and emits the RFC 7807 response.

## Testing

Story tests for the registration:

```typescript
import { ErrorCodeRegistry } from '@/core/errors/error-code-registry.js';
import { APP_PROJECT_LIMIT_REACHED } from '@/modules/projects/projects.errors.js';

it('the registry resolves the code in en', () => {
  const reg = new ErrorCodeRegistry();
  reg.register(APP_PROJECT_LIMIT_REACHED);
  const resolved = reg.resolve('APP_PROJECT_LIMIT_REACHED', 'en', { limit: '10' });
  expect(resolved.title).toBe('Project limit reached');
  expect(resolved.detail).toContain('10');
});
```

E2E tests for the throw path:

```typescript
const res = await request(app)
  .post('/projects')
  .set('Authorization', `Bearer ${token}`)
  .set('Accept-Language', 'de')
  .send({ name: 'over the limit' });

expect(res.status).toBe(409);
expect(res.body).toMatchObject({
  type: expect.stringContaining('APP_PROJECT_LIMIT_REACHED'),
  code: 'APP_PROJECT_LIMIT_REACHED',
  title: 'Projekt-Limit erreicht',
  detail: expect.stringContaining('10'),
});
```

## Locale fallback

If the request comes in with a locale your code doesn't know, the
registry falls back to `en`. That's why `en` is required.

If a placeholder isn't supplied in `vars`, the registry leaves it
intact (`{{limit}}`) — surfaces the bug in dev rather than silently
rendering an empty slot.

## Common patterns

| Symptom | Code | Status |
|---|---|---|
| Resource not found | `APP_<RESOURCE>_NOT_FOUND` | 404 |
| Permission denied (post-CASL) | `APP_<RESOURCE>_FORBIDDEN` | 403 |
| Quota exceeded | `APP_<RESOURCE>_LIMIT_REACHED` | 409 |
| Invalid state transition | `APP_<RESOURCE>_INVALID_TRANSITION` | 422 |
| External integration failure | `APP_<INTEGRATION>_UPSTREAM_ERROR` | 502 |

Use `CORE_*` codes for cross-cutting concerns (`CORE_VALIDATION`,
`CORE_UNAUTHORIZED`, `CORE_RATE_LIMITED`). Use `APP_*` for resource-
specific business errors.

## Don't

- **Don't reuse a code with a different meaning** — once shipped, the
  code is a behavioural contract. Add a new one instead.
- **Don't put project-specific codes in `src/core/`** — that's a
  template change, not a project change.
- **Don't skip the locale fallback** — `en` is required as the
  universal default. Adding only `de` will break English speakers.
- **Don't put PII in placeholders** — error messages get logged.
  `{{user-email}}` is an audit-log leak waiting to happen; use IDs.
