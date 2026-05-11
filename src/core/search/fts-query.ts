/**
 * Postgres FTS query helpers.
 *
 * `to_tsquery` rejects malformed input; user-supplied search strings
 * need normalization before they hit the DB. The helpers here cover
 * the edge cases that production traffic hits:
 *   - special operators (& | ! : * ()) stripped
 *   - whitespace collapsed
 *   - prefix-search support (`foo:*`) on the last token
 *   - empty input rejected
 *
 * **Negation (`!`) is not supported** — it is silently removed during
 * sanitization. Postgres FTS negation requires `tsquery` NOT-operator
 * syntax (e.g. `!foo` in `to_tsquery`), but the downstream query uses
 * `plainto_tsquery`-compatible input assembled via `& ` joins. Attempting
 * to pass `!foo` through would either produce an empty token or a malformed
 * `tsquery` string. Callers that need negation must use a different query
 * path that constructs a raw `to_tsquery` expression.
 */

// OPERATOR_RE strips tsquery metacharacters that cannot be expressed in the
// `plainto_tsquery`-compatible surface this helper targets. The `!` character
// is intentionally included: it is the tsquery NOT operator and would require
// `to_tsquery` (not `plainto_tsquery`) to express safely. Stripping it means
// a query like "!foo" becomes "foo" — the negation intent is silently lost.
// See the module JSDoc above for the rationale.
const OPERATOR_RE = /[&|!:*()]/g;
const NON_WORD_RE = /[\s]+/g;

export function sanitizeFtsQuery(input: string): string {
  const stripped = input.replace(OPERATOR_RE, " ").replace(NON_WORD_RE, " ").trim();
  if (stripped === "") {
    throw new Error("fts: query is empty after sanitization");
  }
  return stripped;
}

export interface ToTsqueryOptions {
  /** When true, the last token gets `:*` for prefix-search (typeahead). */
  prefix?: boolean;
}

/**
 * Convert a user-supplied search string to a Postgres `tsquery` expression
 * suitable for use with `to_tsquery()`.
 *
 * Sanitizes the input via `sanitizeFtsQuery` (strips tsquery metacharacters,
 * collapses whitespace) then joins tokens with `&` (AND semantics).
 *
 * **Limitation — negation is not supported.** A query like `!foo` is silently
 * treated as `foo` because this helper targets `plainto_tsquery`-compatible
 * input. Use a raw `to_tsquery` expression if you need NOT semantics.
 */
export function toTsquery(input: string, options: ToTsqueryOptions = {}): string {
  const sanitized = sanitizeFtsQuery(input);
  const tokens = sanitized.split(" ").filter(Boolean);
  if (options.prefix && tokens.length > 0) {
    tokens[tokens.length - 1] = `${tokens[tokens.length - 1]}:*`;
  }
  return tokens.join(" & ");
}
