/**
 * Email locale fallback planner (CF.EMAIL.09).
 *
 * Given a recipient's preferred locale and the set of locales the
 * email layer ships templates for, this planner returns the ordered
 * try-chain the EmailService walks at send time.
 *
 * Fallback rules — specific → generic → default:
 *   1. Exact match on the user's preferred locale (e.g. `de-AT`).
 *   2. Language root (e.g. `de`) when the regional variant isn't
 *      available.
 *   3. The configured default locale (e.g. `en`) — last-resort,
 *      always present in the chain even when it isn't in
 *      `availableLocales`. The send pipeline surfaces a missing-
 *      template error separately if the default itself can't render.
 *
 * The planner is pure: same inputs always yield the same output. It
 * does NOT touch the file system. The runner (EmailService) walks
 * the chain at send time.
 */

export interface LocaleFallbackInput {
  /** Recipient's preferred locale, possibly undefined or empty. */
  readonly userLocale: string | undefined;
  /** Project-default locale used as last-resort fallback. */
  readonly defaultLocale: string;
  /** Locales for which the requested template ships. */
  readonly availableLocales: readonly string[];
}

/**
 * Normalise a locale string to canonical form: language part lower-
 * cased, region part upper-cased. `de-AT`, `de-at`, `DE-at`, and
 * `DE-AT` all collapse to `de-AT`.
 */
function normaliseLocale(locale: string): string {
  const parts = locale.split("-");
  if (parts.length === 1) return parts[0]!.toLowerCase();
  const [lang, region, ...rest] = parts;
  if (rest.length > 0) {
    return [lang!.toLowerCase(), region!.toUpperCase(), ...rest].join("-");
  }
  return `${lang!.toLowerCase()}-${region!.toUpperCase()}`;
}

/**
 * Drop the regional suffix and keep the language root only.
 * `de-AT` → `de`, `en-GB` → `en`. Returns the input unchanged if
 * there's no region part.
 */
function languageRoot(locale: string): string {
  const dashAt = locale.indexOf("-");
  return dashAt === -1 ? locale : locale.slice(0, dashAt);
}

/**
 * Resolve the ordered locale fallback chain for a given recipient
 * and template availability.
 */
export function resolveLocaleFallbackChain(input: LocaleFallbackInput): string[] {
  const defaultLocale = input.defaultLocale;
  const available = new Set(input.availableLocales.map(normaliseLocale));
  const chain: string[] = [];
  const seen = new Set<string>();

  const push = (candidate: string): void => {
    if (!seen.has(candidate)) {
      seen.add(candidate);
      chain.push(candidate);
    }
  };

  // 1. Exact user-locale match (regional variant if specified).
  const trimmedUser = (input.userLocale ?? "").trim();
  if (trimmedUser !== "") {
    const userNormalised = normaliseLocale(trimmedUser);
    if (available.has(userNormalised)) {
      push(userNormalised);
    }
    // 2. Language root if the regional variant isn't available
    //    (or even if it is — adding the root after gives a graceful
    //    degradation for templates that only ship a regional file).
    const root = languageRoot(userNormalised);
    if (root !== userNormalised && available.has(root)) {
      push(root);
    }
  }

  // 3. Default locale — last-resort guarantee. Always present, even
  //    when it isn't in availableLocales (the runner surfaces the
  //    missing-template error separately if the default fails).
  push(defaultLocale);

  return chain;
}
