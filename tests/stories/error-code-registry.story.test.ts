import { describe, expect, it } from 'vitest';

import {
  ErrorCodeAlreadyRegisteredError,
  ErrorCodeNotFoundError,
  ErrorCodeRegistry,
  type ErrorCodeDefinition,
} from '../../src/core/errors/error-code-registry.js';

/**
 * Story · Error-Code-Registry + i18n endpoint
 * (PLAN.md §32 Phase 8 + §28.8 #22).
 *
 * The registry is the single source of truth for `CORE_*` and
 * `APP_*` error codes. Each code carries:
 *   - default-locale title + detail
 *   - per-locale overrides (we ship `en` + `de` defaults)
 *   - status code (HTTP)
 *   - mustache-style placeholder support so detail messages can
 *     interpolate request-specific values
 *
 * The `/errors` controller serves `registry.list(locale)` so client
 * tooling can discover the catalog without knowing TypeScript.
 */
describe('Story · Error-Code-Registry', () => {
  function definition(overrides: Partial<ErrorCodeDefinition> = {}): ErrorCodeDefinition {
    return {
      code: 'APP_FOO',
      status: 400,
      messages: {
        en: { title: 'Foo failed', detail: 'Could not foo {{thing}}' },
      },
      ...overrides,
    };
  }

  describe('register / get / list', () => {
    it('exposes a registered code through `get(code)`', () => {
      const reg = new ErrorCodeRegistry();
      reg.register(definition());
      expect(reg.get('APP_FOO')?.status).toBe(400);
    });

    it('throws ErrorCodeAlreadyRegisteredError on duplicate code', () => {
      const reg = new ErrorCodeRegistry();
      reg.register(definition());
      expect(() => reg.register(definition())).toThrow(ErrorCodeAlreadyRegisteredError);
    });

    it('returns undefined for an unknown code (not throw — callers decide)', () => {
      const reg = new ErrorCodeRegistry();
      expect(reg.get('UNKNOWN')).toBeUndefined();
    });

    it('list() returns codes sorted alphabetically (deterministic for the /errors endpoint)', () => {
      const reg = new ErrorCodeRegistry();
      reg.register(definition({ code: 'APP_ZZZ' }));
      reg.register(definition({ code: 'APP_AAA' }));
      reg.register(definition({ code: 'APP_MMM' }));
      expect(reg.list().map((d) => d.code)).toEqual(['APP_AAA', 'APP_MMM', 'APP_ZZZ']);
    });

    it('rejects a malformed code (must match /^[A-Z][A-Z0-9_]+$/)', () => {
      const reg = new ErrorCodeRegistry();
      expect(() => reg.register(definition({ code: 'lowercase' }))).toThrow(/code/i);
      expect(() => reg.register(definition({ code: '1NUMBER_FIRST' }))).toThrow(/code/i);
    });

    it('rejects a definition without an `en` message (en is the fallback locale)', () => {
      const reg = new ErrorCodeRegistry();
      expect(() =>
        reg.register({ code: 'APP_NO_EN', status: 400, messages: { de: { title: 'X' } } } as never),
      ).toThrow(/en/i);
    });
  });

  describe('resolve()', () => {
    it('returns the en message when locale is en', () => {
      const reg = new ErrorCodeRegistry();
      reg.register(definition());
      const resolved = reg.resolve('APP_FOO', 'en', { thing: 'bar' });
      expect(resolved.title).toBe('Foo failed');
      expect(resolved.detail).toBe('Could not foo bar');
    });

    it('uses the locale-specific message when present', () => {
      const reg = new ErrorCodeRegistry();
      reg.register(
        definition({
          messages: {
            en: { title: 'Foo failed', detail: 'Could not foo {{thing}}' },
            de: { title: 'Foo fehlgeschlagen', detail: 'Konnte {{thing}} nicht foo-en' },
          },
        }),
      );
      const resolved = reg.resolve('APP_FOO', 'de', { thing: 'bar' });
      expect(resolved.title).toBe('Foo fehlgeschlagen');
      expect(resolved.detail).toBe('Konnte bar nicht foo-en');
    });

    it('falls back to en when the requested locale is missing', () => {
      const reg = new ErrorCodeRegistry();
      reg.register(definition());
      const resolved = reg.resolve('APP_FOO', 'fr', { thing: 'bar' });
      expect(resolved.title).toBe('Foo failed');
    });

    it('substitutes multiple placeholders', () => {
      const reg = new ErrorCodeRegistry();
      reg.register(
        definition({
          messages: { en: { title: 't', detail: '{{a}} and {{b}} differ' } },
        }),
      );
      expect(reg.resolve('APP_FOO', 'en', { a: 'x', b: 'y' }).detail).toBe('x and y differ');
    });

    it('leaves unsubstituted placeholders intact (so missing vars surface in dev)', () => {
      const reg = new ErrorCodeRegistry();
      reg.register(definition());
      expect(reg.resolve('APP_FOO', 'en', {}).detail).toBe('Could not foo {{thing}}');
    });

    it('omits detail when the locale message has no detail', () => {
      const reg = new ErrorCodeRegistry();
      reg.register(definition({ messages: { en: { title: 'Title only' } } }));
      const resolved = reg.resolve('APP_FOO', 'en', {});
      expect(resolved.detail).toBeUndefined();
    });

    it('throws ErrorCodeNotFoundError for an unknown code', () => {
      const reg = new ErrorCodeRegistry();
      expect(() => reg.resolve('UNKNOWN', 'en', {})).toThrow(ErrorCodeNotFoundError);
    });
  });

  describe('listLocales()', () => {
    it('returns all locales advertised by any registered code (sorted, deduped)', () => {
      const reg = new ErrorCodeRegistry();
      reg.register(definition({ code: 'A', messages: { en: { title: 'a' }, de: { title: 'a' } } }));
      reg.register(definition({ code: 'B', messages: { en: { title: 'b' }, fr: { title: 'b' } } }));
      expect(reg.listLocales()).toEqual(['de', 'en', 'fr']);
    });
  });
});
