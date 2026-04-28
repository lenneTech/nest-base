import { Inject, Injectable } from '@nestjs/common';

import type { AppConfig } from './app-config.js';
import type { CookieConfig, CorsConfig } from '../http/cookie-cors-config.js';
import type { ServerConfig } from '../server/server-config.js';
import type { SystemSetupConfig } from '../setup/system-setup-config.js';

export const APP_CONFIG_TOKEN = Symbol('APP_CONFIG');

/**
 * Read-only accessor for the validated `AppConfig` produced at boot.
 *
 * Consumers inject `ConfigService` and read `config.server.port`,
 * `config.cookies.secure`, etc. The underlying `AppConfig` object is
 * frozen at construction time to prevent accidental runtime mutation.
 */
@Injectable()
export class ConfigService {
  constructor(@Inject(APP_CONFIG_TOKEN) private readonly cfg: AppConfig) {
    Object.freeze(this.cfg);
    Object.freeze(this.cfg.server);
    Object.freeze(this.cfg.systemSetup);
    Object.freeze(this.cfg.cookies);
    Object.freeze(this.cfg.cors);
  }

  get all(): AppConfig {
    return this.cfg;
  }

  get server(): ServerConfig {
    return this.cfg.server;
  }

  get systemSetup(): SystemSetupConfig {
    return this.cfg.systemSetup;
  }

  get cookies(): CookieConfig {
    return this.cfg.cookies;
  }

  get cors(): CorsConfig {
    return this.cfg.cors;
  }
}
