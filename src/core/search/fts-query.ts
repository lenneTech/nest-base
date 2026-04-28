/**
 * Postgres FTS query helpers (PLAN.md §11 + §28.4/#17).
 *
 * `to_tsquery` rejects malformed input; user-supplied search strings
 * need normalization before they hit the DB. The helpers here cover
 * the edge cases that production traffic hits:
 *   - special operators (& | ! : * ()) stripped
 *   - whitespace collapsed
 *   - prefix-search support (`foo:*`) on the last token
 *   - empty input rejected
 */

const OPERATOR_RE = /[&|!:*()]/g;
const NON_WORD_RE = /[\s]+/g;

export function sanitizeFtsQuery(input: string): string {
  const stripped = input.replace(OPERATOR_RE, ' ').replace(NON_WORD_RE, ' ').trim();
  if (stripped === '') {
    throw new Error('fts: query is empty after sanitization');
  }
  return stripped;
}

export interface ToTsqueryOptions {
  /** When true, the last token gets `:*` for prefix-search (typeahead). */
  prefix?: boolean;
}

export function toTsquery(input: string, options: ToTsqueryOptions = {}): string {
  const sanitized = sanitizeFtsQuery(input);
  const tokens = sanitized.split(' ').filter(Boolean);
  if (options.prefix && tokens.length > 0) {
    tokens[tokens.length - 1] = `${tokens[tokens.length - 1]}:*`;
  }
  return tokens.join(' & ');
}
