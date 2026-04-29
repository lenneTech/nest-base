/**
 * Effective base URL planner.
 *
 * `APP_BASE_URL` in `.env` is the user-facing URL — typically a portless
 * route like `https://api.<project>.localhost`. When the dev runner
 * boots without portless (binary missing, `DISABLE_PORTLESS=1`, or
 * `bun src/main.ts` invoked directly), that URL is unreachable and
 * any banner / sidebar / OpenAPI link that points at it 404s.
 *
 * The planner picks the URL that actually answers right now:
 *   - portless explicitly disabled → http://localhost:<port>
 *   - portless missing on PATH    → http://localhost:<port>
 *   - portless available + assumed running → keep APP_BASE_URL
 *
 * Pure: takes inputs explicitly, no I/O. The runner in bootstrap
 * fills the env-vars, the dx subagents render the result.
 */

export interface EffectiveBaseUrlInput {
  /** APP_BASE_URL as resolved by `serverConfigFromEnv`. */
  baseUrl: string;
  /** Bound port (cfg.port). */
  port: number;
  /** Selected env-var surface — kept narrow on purpose. */
  env_vars: {
    DISABLE_PORTLESS?: string;
    /** Set by `scripts/dev.ts` once it has detected portless on PATH. */
    PORTLESS_ACTIVE?: string;
  };
}

export interface EffectiveBaseUrl {
  /** URL the user should click — portless-aware. */
  publicUrl: string;
  /** URL the server itself should hit for self-probes. */
  loopbackUrl: string;
  /** True when the public URL points at the portless proxy. */
  viaPortless: boolean;
}

export function resolveEffectiveBaseUrl(input: EffectiveBaseUrlInput): EffectiveBaseUrl {
  const loopback = `http://localhost:${input.port}`;
  const disabled = input.env_vars.DISABLE_PORTLESS === "1";
  const active = input.env_vars.PORTLESS_ACTIVE === "1";
  if (disabled || !active) {
    return { publicUrl: loopback, loopbackUrl: loopback, viaPortless: false };
  }
  return {
    publicUrl: input.baseUrl.replace(/\/$/, ""),
    loopbackUrl: loopback,
    viaPortless: true,
  };
}
