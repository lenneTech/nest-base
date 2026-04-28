import {
  type AppEnv,
  type CookieConfig,
  type CorsConfig,
  cookieDefaults,
  corsDefaults,
} from '../http/cookie-cors-config.js';
import { type ServerConfig, serverConfigFromEnv } from '../server/server-config.js';
import { type SystemSetupConfig, systemSetupConfigFromEnv } from '../setup/system-setup-config.js';

/**
 * Unified `AppConfig` — single source of truth for everything env-derived.
 *
 * Composition:
 *   - server: serverConfigFromEnv()       (PORT/HOST/BASE_URL/NODE_ENV)
 *   - systemSetup: systemSetupConfigFromEnv()
 *   - cookies/cors: derived defaults driven by `server.env`
 *
 * Sub-modules continue to own their own schemas; this loader composes
 * them and ensures the boot fails fast on the first invalid value.
 */
export interface AppConfig {
  server: ServerConfig;
  systemSetup: SystemSetupConfig;
  cookies: CookieConfig;
  cors: CorsConfig;
}

export type EnvInput = Record<string, string | undefined>;

export function loadAppConfig(env: EnvInput): AppConfig {
  const server = serverConfigFromEnv(env);
  const systemSetup = systemSetupConfigFromEnv(env);
  const appEnv: AppEnv = server.env;
  return {
    server,
    systemSetup,
    cookies: cookieDefaults(appEnv),
    cors: corsDefaults(appEnv),
  };
}
