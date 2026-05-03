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

export function corsDefaults(env: AppEnv): CorsConfig {
  if (env === "development") {
    return {
      allowedOrigins: [
        "http://localhost:3000",
        // Default Nuxt dev port for the lt fullstack template's
        // `projects/app/` frontend — keeps a freshly-scaffolded SPA able
        // to call its own API without a proxy workaround.
        "http://localhost:3001",
        "http://localhost:5173",
        "http://app.nst.localhost",
      ],
      credentials: true,
      maxAgeSeconds: 600,
    };
  }
  return { allowedOrigins: [], credentials: false, maxAgeSeconds: 600 };
}
