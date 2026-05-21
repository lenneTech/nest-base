import { z } from "zod";

/**
 * Cookie & CORS config schemas (Phase 1 deliverable).
 *
 * The middleware consumers (helmet/csp, auth-cookie, fastify-cors)
 * are wired up later. This module owns the schema + sensible defaults
 * per `NODE_ENV`.
 */

export type AppEnv = "development" | "staging" | "production";

const SAME_SITE_VALUES = ["strict", "lax", "none"] as const;
export type SameSite = (typeof SAME_SITE_VALUES)[number];

export const CookieConfigSchema = z
  .object({
    name: z.string().min(1),
    httpOnly: z.boolean(),
    secure: z.boolean(),
    sameSite: z.enum(SAME_SITE_VALUES),
    path: z.string().min(1),
    domain: z.string().optional(),
    maxAgeSeconds: z.number().int().positive(),
  })
  .refine((cfg) => !(cfg.sameSite === "none" && !cfg.secure), {
    message: "SameSite=none requires Secure=true (RFC 6265 + Chrome enforcement)",
  });

export type CookieConfig = z.infer<typeof CookieConfigSchema>;

export const CorsConfigSchema = z
  .object({
    allowedOrigins: z.array(z.string().min(1)),
    credentials: z.boolean(),
    maxAgeSeconds: z.number().int().nonnegative(),
  })
  .refine((cfg) => !(cfg.credentials && cfg.allowedOrigins.length === 0), {
    message:
      "credentials=true requires at least one allowed origin (browsers reject `*` + credentials)",
  });

export type CorsConfig = z.infer<typeof CorsConfigSchema>;

/**
 * Defaults per environment. Production is strict by design; development
 * permits localhost-friendly Secure=false. Staging mirrors production.
 */
export function cookieDefaults(env: AppEnv): CookieConfig {
  const base = {
    name: "nst_session",
    httpOnly: true,
    sameSite: "lax" as SameSite,
    path: "/",
    maxAgeSeconds: 60 * 60 * 24 * 7,
  };
  return env === "development" ? { ...base, secure: false } : { ...base, secure: true };
}

export function corsDefaults(
  env: AppEnv,
  envVars?: Record<string, string | undefined>,
): CorsConfig {
  if (env === "development") {
    return {
      allowedOrigins: [
        "http://localhost:3000",
        // Default Nuxt dev port for the lt fullstack template's
        // `projects/app/` frontend — keeps a freshly-scaffolded SPA able
        // to call its own API without a proxy workaround.
        "http://localhost:3001",
        "http://localhost:5173",
        // Expo web / Metro dev server (React Native projects) — lets the
        // Expo Web build call the dev API with credentials.
        "http://localhost:8081",
        "http://localhost:19006",
        "http://app.nst.localhost",
      ],
      credentials: true,
      maxAgeSeconds: 600,
    };
  }
  return productionCorsConfig(envVars);
}

/**
 * Build CORS config for staging/production from `CORS_ALLOWED_ORIGINS`.
 *
 * Set the env-var to a comma-separated list of allowed origins:
 *   CORS_ALLOWED_ORIGINS=https://app.example.com,https://www.example.com
 *
 * When unset, all origins are denied (`allowedOrigins: []`) — the safe
 * default that prevents credential-bearing cross-origin requests.
 */
function productionCorsConfig(envVars?: Record<string, string | undefined>): CorsConfig {
  const vars = envVars ?? (process.env as Record<string, string | undefined>);
  const rawOrigins = vars["CORS_ALLOWED_ORIGINS"];
  const allowedOrigins = rawOrigins
    ? rawOrigins
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean)
    : [];

  // MIN-1: validate each origin so misconfigured wildcards or typos fail
  // loudly at startup rather than silently allowing unexpected origins.
  for (const origin of allowedOrigins) {
    if (!/^https?:\/\/[^,*\s]+$/.test(origin)) {
      throw new Error(
        `CORS_ALLOWED_ORIGINS: invalid origin "${origin}" — ` +
          `wildcards and spaces are not allowed. Use a full URL like "https://app.example.com".`,
      );
    }
  }

  return {
    allowedOrigins,
    credentials: allowedOrigins.length > 0,
    maxAgeSeconds: 600,
  };
}
