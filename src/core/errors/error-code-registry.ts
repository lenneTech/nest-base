/**
 * Error-Code-Registry + i18n endpoint
 * (PLAN.md §32 Phase 8 + §28.8 #22).
 *
 * Single source of truth for `CORE_*` and `APP_*` error codes.
 * The exception filter (`problem-details.filter.ts`) maps thrown
 * sentinels to RFC 7807 responses; that filter calls
 * `registry.resolve(code, locale, vars)` to fill in title + detail
 * with the right language and request-specific values.
 *
 * The `/errors` controller serves `registry.list(locale)` so client
 * tooling can discover the catalog without reading the TypeScript
 * source.
 */

const CODE_RE = /^[A-Z][A-Z0-9_]+$/;

export interface ErrorCodeMessage {
  title: string;
  detail?: string;
}

export interface ErrorCodeDefinition {
  code: string;
  status: number;
  /** Per-locale messages. `en` is required as the universal fallback. */
  messages: Record<string, ErrorCodeMessage> & { en: ErrorCodeMessage };
}

export interface ResolvedErrorMessage {
  code: string;
  status: number;
  title: string;
  detail?: string;
}

export class ErrorCodeAlreadyRegisteredError extends Error {
  constructor(code: string) {
    super(`error-code-registry: code "${code}" is already registered`);
    this.name = "ErrorCodeAlreadyRegisteredError";
  }
}

export class ErrorCodeNotFoundError extends Error {
  constructor(code: string) {
    super(`error-code-registry: code "${code}" is not registered`);
    this.name = "ErrorCodeNotFoundError";
  }
}

export class ErrorCodeRegistry {
  private readonly codes = new Map<string, ErrorCodeDefinition>();

  register(definition: ErrorCodeDefinition): void {
    if (!CODE_RE.test(definition.code)) {
      throw new Error(`error-code-registry: code "${definition.code}" must match ${CODE_RE}`);
    }
    if (!definition.messages || !definition.messages.en) {
      throw new Error(
        `error-code-registry: code "${definition.code}" must include an "en" message (fallback locale)`,
      );
    }
    if (this.codes.has(definition.code)) {
      throw new ErrorCodeAlreadyRegisteredError(definition.code);
    }
    this.codes.set(definition.code, definition);
  }

  get(code: string): ErrorCodeDefinition | undefined {
    return this.codes.get(code);
  }

  list(): ErrorCodeDefinition[] {
    return [...this.codes.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  listLocales(): string[] {
    const seen = new Set<string>();
    for (const def of this.codes.values()) {
      for (const locale of Object.keys(def.messages)) {
        seen.add(locale);
      }
    }
    return [...seen].sort();
  }

  resolve(code: string, locale: string, vars: Record<string, string>): ResolvedErrorMessage {
    const def = this.codes.get(code);
    if (!def) throw new ErrorCodeNotFoundError(code);
    const message = def.messages[locale] ?? def.messages.en;
    return {
      code: def.code,
      status: def.status,
      title: substitute(message.title, vars),
      ...(message.detail !== undefined ? { detail: substitute(message.detail, vars) } : {}),
    };
  }
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER_RE, (match, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key]! : match;
  });
}
