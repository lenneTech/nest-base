import { describe, expect, it } from 'vitest';

import { ServerConfigSchema, defaultServerConfig, serverConfigFromEnv } from '../src/core/server/server-config.js';

/**
 * Adapted from nest-server `server.e2e-spec.ts`.
 *
 * What this iteration covers — server-config schema only. Boot-smoketests
 * (`/health/live`, `/health/ready`, route discovery) land when the NestJS
 * app boots in the next slice.
 */
describe('Server config', () => {
  it('accepts a complete config', () => {
    const parsed = ServerConfigSchema.safeParse({
      port: 3000,
      host: '127.0.0.1',
      baseUrl: 'http://localhost:3000',
      env: 'development',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects ports outside the valid TCP range', () => {
    expect(ServerConfigSchema.safeParse({ port: 0, host: '0.0.0.0', baseUrl: 'http://x', env: 'development' }).success).toBe(false);
    expect(ServerConfigSchema.safeParse({ port: 65_536, host: '0.0.0.0', baseUrl: 'http://x', env: 'development' }).success).toBe(false);
  });

  it('rejects invalid baseUrl values', () => {
    expect(
      ServerConfigSchema.safeParse({ port: 3000, host: '0.0.0.0', baseUrl: 'not-a-url', env: 'development' }).success,
    ).toBe(false);
  });

  it('rejects unknown env values', () => {
    const parsed = ServerConfigSchema.safeParse({
      port: 3000,
      host: '0.0.0.0',
      baseUrl: 'http://localhost:3000',
      env: 'staging-but-not-listed',
    });
    expect(parsed.success).toBe(false);
  });

  it('defaultServerConfig() returns a valid development config', () => {
    const cfg = defaultServerConfig();
    expect(ServerConfigSchema.safeParse(cfg).success).toBe(true);
    expect(cfg.env).toBe('development');
  });

  it('serverConfigFromEnv() applies defaults for missing env-vars', () => {
    const cfg = serverConfigFromEnv({});
    expect(ServerConfigSchema.safeParse(cfg).success).toBe(true);
  });

  it('serverConfigFromEnv() prefers PORT/HOST/APP_BASE_URL/NODE_ENV over defaults', () => {
    const cfg = serverConfigFromEnv({
      PORT: '4000',
      HOST: '1.2.3.4',
      APP_BASE_URL: 'https://api.example.com',
      NODE_ENV: 'production',
    });
    expect(cfg.port).toBe(4000);
    expect(cfg.host).toBe('1.2.3.4');
    expect(cfg.baseUrl).toBe('https://api.example.com');
    expect(cfg.env).toBe('production');
  });

  it('serverConfigFromEnv() throws on a non-numeric PORT', () => {
    expect(() => serverConfigFromEnv({ PORT: 'not-a-number' })).toThrow();
  });
});
