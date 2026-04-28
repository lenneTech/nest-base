import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { ConfigModule } from '../../src/core/config/config.module.js';
import { ConfigService } from '../../src/core/config/config.service.js';
import { loadAppConfig } from '../../src/core/config/app-config.js';

/**
 * Story · ENV-Validation + Config-Modul
 *
 * The server reads every env-var through one Zod-validated `AppConfig`
 * loader. Any malformed / missing required value crashes the boot before
 * NestJS spins up. Sub-configs (server, systemSetup, cookies, cors) are
 * surfaced via `ConfigService` and stay typed end-to-end.
 */
describe('Story · ENV-Validation + Config Module', () => {
  describe('loadAppConfig()', () => {
    it('returns a valid config for a minimal env (defaults applied)', () => {
      const cfg = loadAppConfig({});
      expect(cfg.server.port).toBeGreaterThan(0);
      expect(cfg.server.env).toBe('development');
      expect(cfg.systemSetup.enabled).toBe(false);
      expect(cfg.cookies.httpOnly).toBe(true);
    });

    it('reads PORT/HOST/APP_BASE_URL/NODE_ENV into server config', () => {
      const cfg = loadAppConfig({
        PORT: '4000',
        HOST: '1.2.3.4',
        APP_BASE_URL: 'https://api.example.com',
        NODE_ENV: 'production',
      });
      expect(cfg.server.port).toBe(4000);
      expect(cfg.server.host).toBe('1.2.3.4');
      expect(cfg.server.baseUrl).toBe('https://api.example.com');
      expect(cfg.server.env).toBe('production');
    });

    it('reads SYSTEM_SETUP_ADMIN_* into systemSetup', () => {
      const cfg = loadAppConfig({
        SYSTEM_SETUP_ADMIN_EMAIL: 'admin@example.com',
        SYSTEM_SETUP_ADMIN_PASSWORD: 'super-secret-12345',
      });
      expect(cfg.systemSetup.enabled).toBe(true);
      expect(cfg.systemSetup.adminEmail).toBe('admin@example.com');
    });

    it('cookies/cors defaults match the server env (production locks them down)', () => {
      const dev = loadAppConfig({ NODE_ENV: 'development' });
      expect(dev.cookies.secure).toBe(false);
      expect(dev.cors.credentials).toBe(true);
      expect(dev.cors.allowedOrigins.length).toBeGreaterThan(0);

      const prod = loadAppConfig({ NODE_ENV: 'production' });
      expect(prod.cookies.secure).toBe(true);
      expect(prod.cors.credentials).toBe(false);
      expect(prod.cors.allowedOrigins).toEqual([]);
    });

    it('throws fail-fast on a malformed PORT (no half-validated boot)', () => {
      expect(() => loadAppConfig({ PORT: 'abc' })).toThrow();
    });

    it('throws fail-fast on a malformed APP_BASE_URL', () => {
      expect(() => loadAppConfig({ APP_BASE_URL: 'not-a-url' })).toThrow();
    });

    it('falls back to the default when BASE_URL is set to "/" (Vite/Vitest sentinel)', () => {
      const cfg = loadAppConfig({ BASE_URL: '/' });
      expect(cfg.server.baseUrl).toBe('http://localhost:3000');
    });

    it('throws fail-fast on a partial system-setup env (email without password)', () => {
      expect(() =>
        loadAppConfig({
          SYSTEM_SETUP_ADMIN_EMAIL: 'admin@example.com',
        }),
      ).toThrow(/password/i);
    });
  });

  describe('ConfigService (NestJS DI)', () => {
    it('is provided globally and exposes typed sub-configs', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [ConfigModule.forRoot({ env: { NODE_ENV: 'production', APP_BASE_URL: 'https://api.example.com' } })],
      }).compile();

      const config = moduleRef.get(ConfigService);

      expect(config.server.env).toBe('production');
      expect(config.cookies.secure).toBe(true);
      expect(config.cors.credentials).toBe(false);
      expect(config.systemSetup.enabled).toBe(false);

      await moduleRef.close();
    });

    it('forRoot() defaults to process.env when no env override is given', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [ConfigModule.forRoot()],
      }).compile();
      const config = moduleRef.get(ConfigService);
      expect(typeof config.server.port).toBe('number');
      await moduleRef.close();
    });
  });
});
