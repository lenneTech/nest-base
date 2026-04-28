import { z } from 'zod';

/**
 * System Setup config (Phase 2 will wire the actual provisioning).
 *
 * The bootstrap admin is provisioned from env-vars on first boot. Setup is
 * idempotent: re-running with the same credentials must not recreate the
 * user. This module owns the env-input parsing only.
 */

export const SystemSetupConfigSchema = z.object({
  adminEmail: z.email(),
  adminPassword: z.string().min(12),
  enabled: z.boolean(),
});

export type SystemSetupConfig = z.infer<typeof SystemSetupConfigSchema>;

export interface SystemSetupEnv {
  SYSTEM_SETUP_ADMIN_EMAIL?: string;
  SYSTEM_SETUP_ADMIN_PASSWORD?: string;
}

/**
 * Read system-setup config from env. If both email and password are
 * missing, setup is disabled (no auto-bootstrap). Partial input throws —
 * a half-set config is almost certainly a deployment mistake.
 */
export function systemSetupConfigFromEnv(env: SystemSetupEnv): SystemSetupConfig {
  const email = env.SYSTEM_SETUP_ADMIN_EMAIL;
  const password = env.SYSTEM_SETUP_ADMIN_PASSWORD;

  if (!email && !password) {
    return {
      adminEmail: 'disabled@invalid.local',
      adminPassword: 'system-setup-disabled-placeholder',
      enabled: false,
    };
  }

  if (!password) {
    throw new Error('SYSTEM_SETUP_ADMIN_EMAIL is set but SYSTEM_SETUP_ADMIN_PASSWORD is missing');
  }
  if (!email) {
    throw new Error('SYSTEM_SETUP_ADMIN_PASSWORD is set but SYSTEM_SETUP_ADMIN_EMAIL is missing');
  }

  return SystemSetupConfigSchema.parse({
    adminEmail: email,
    adminPassword: password,
    enabled: true,
  });
}
