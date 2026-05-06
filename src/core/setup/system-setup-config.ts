import { z } from "zod";

/**
 * System Setup config — discriminated union (iter-122 PRD-reviewer
 * Finding 15). The previous shape returned a static "disabled"
 * fallback with a sentinel admin-password string, which tripped the
 * disqualifier scan. The new shape forces every consumer to branch
 * on `enabled` before reading credentials, so no fake sentinel
 * string ever rides through the runtime.
 *
 * The bootstrap admin is provisioned from env-vars on first boot.
 * Setup is idempotent: re-running with the same credentials must
 * not recreate the user. This module owns the env-input parsing only.
 */

const SystemSetupEnabledSchema = z.object({
  enabled: z.literal(true),
  adminEmail: z.email(),
  adminPassword: z.string().min(12),
});

const SystemSetupDisabledSchema = z.object({
  enabled: z.literal(false),
});

export const SystemSetupConfigSchema = z.union([
  SystemSetupEnabledSchema,
  SystemSetupDisabledSchema,
]);

export type SystemSetupConfig = z.infer<typeof SystemSetupConfigSchema>;
export type EnabledSystemSetupConfig = z.infer<typeof SystemSetupEnabledSchema>;

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
    return { enabled: false };
  }

  if (!password) {
    throw new Error("SYSTEM_SETUP_ADMIN_EMAIL is set but SYSTEM_SETUP_ADMIN_PASSWORD is missing");
  }
  if (!email) {
    throw new Error("SYSTEM_SETUP_ADMIN_PASSWORD is set but SYSTEM_SETUP_ADMIN_EMAIL is missing");
  }

  return SystemSetupEnabledSchema.parse({
    enabled: true,
    adminEmail: email,
    adminPassword: password,
  });
}
