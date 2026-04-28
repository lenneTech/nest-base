import { z } from 'zod';

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

const DEFAULT_MOUNT_PATH = '/api/auth';

/** Validate + normalize the Better-Auth handler mount path. */
export function resolveBetterAuthMountPath(custom?: string): string {
  const candidate = custom ?? DEFAULT_MOUNT_PATH;
  if (!candidate.startsWith('/')) {
    throw new Error(`mount path must start with "/" (received: ${candidate})`);
  }
  return candidate;
}
