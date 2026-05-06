import { z } from "zod";

/**
 * Better-Auth configuration surface (Phase 2 / "Better-Auth Integration").
 *
 * The actual integration layer (NestJS adapter, route registration,
 * cookie wiring) lives in upcoming slices. This module owns the
 * ENV-validated config struct that they all consume — kept separate so
 * tests + helpers can run without booting Better-Auth.
 */

export const BetterAuthConfigSchema = z.object({
  emailAndPassword: z.object({
    enabled: z.boolean().default(true),
  }),
  session: z.object({
    expiresInSeconds: z.number().int().positive(),
  }),
});

export type BetterAuthConfig = z.infer<typeof BetterAuthConfigSchema>;

const DEFAULT_SESSION_SECONDS = 60 * 60 * 24 * 7; // 7 days

export function betterAuthConfigDefaults(): BetterAuthConfig {
  return {
    emailAndPassword: { enabled: true },
    session: { expiresInSeconds: DEFAULT_SESSION_SECONDS },
  };
}

const DEFAULT_MOUNT_PATH = "/api/auth";

/**
 * The default Better-Auth handler mount path, exported so middleware and
 * guards that hard-code the path in their static allowlists can reference
 * the same constant. Dynamic runtime reconfiguration of those allowlists
 * is handled by reading `BETTER_AUTH_BASE_PATH` in the factory instead.
 */
export const BETTER_AUTH_DEFAULT_MOUNT_PATH = DEFAULT_MOUNT_PATH;

/**
 * Validate + normalize the Better-Auth handler mount path.
 *
 * Resolution order (first wins):
 * 1. `custom` argument — explicit caller-supplied value (e.g. tests, module factory).
 * 2. `BETTER_AUTH_BASE_PATH` environment variable — operator override at deploy time.
 * 3. Hard-coded default `/api/auth` — backward-compatible fallback.
 */
export function resolveBetterAuthMountPath(custom?: string): string {
  const candidate = custom ?? process.env.BETTER_AUTH_BASE_PATH ?? DEFAULT_MOUNT_PATH;
  if (!candidate.startsWith("/")) {
    throw new Error(`mount path must start with "/" (received: ${candidate})`);
  }
  return candidate;
}
