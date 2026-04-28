import { describe, expect, it } from 'vitest';

import { SystemSetupConfigSchema, systemSetupConfigFromEnv } from '../src/core/setup/system-setup-config.js';

/**
 * Adapted from nest-server `system-setup.e2e-spec.ts`.
 *
 * Story: on first boot the server provisions a single bootstrap admin from
 * env-vars (`SYSTEM_SETUP_ADMIN_EMAIL`, `SYSTEM_SETUP_ADMIN_PASSWORD`).
 * Setup is idempotent — re-running with the same credentials must not
 * recreate the user.
 *
 * What this iteration covers — config-schema only. The actual provisioning
 * lands when Prisma + Better-Auth land (Phase 2). Mock env-input here.
 */
describe('System Setup config', () => {
  it('accepts a complete admin config from env', () => {
    const parsed = SystemSetupConfigSchema.safeParse({
      adminEmail: 'admin@example.com',
      adminPassword: 'super-secret-12345',
      enabled: true,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects passwords below the minimum length (12 chars)', () => {
    const parsed = SystemSetupConfigSchema.safeParse({
      adminEmail: 'admin@example.com',
      adminPassword: 'short',
      enabled: true,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects malformed admin emails', () => {
    const parsed = SystemSetupConfigSchema.safeParse({
      adminEmail: 'not-an-email',
      adminPassword: 'super-secret-12345',
      enabled: true,
    });
    expect(parsed.success).toBe(false);
  });

  it('systemSetupConfigFromEnv() reads env-vars and applies defaults', () => {
    const cfg = systemSetupConfigFromEnv({
      SYSTEM_SETUP_ADMIN_EMAIL: 'admin@example.com',
      SYSTEM_SETUP_ADMIN_PASSWORD: 'super-secret-12345',
    });
    expect(cfg.adminEmail).toBe('admin@example.com');
    expect(cfg.enabled).toBe(true);
  });

  it('systemSetupConfigFromEnv() returns enabled=false when env-vars are missing (no auto-bootstrap)', () => {
    const cfg = systemSetupConfigFromEnv({});
    expect(cfg.enabled).toBe(false);
  });

  it('systemSetupConfigFromEnv() throws on partial env (email without password)', () => {
    expect(() =>
      systemSetupConfigFromEnv({
        SYSTEM_SETUP_ADMIN_EMAIL: 'admin@example.com',
      }),
    ).toThrow(/password/i);
  });
});
