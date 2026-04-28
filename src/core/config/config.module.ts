import { type DynamicModule, Global, Module } from '@nestjs/common';

import { type EnvInput, loadAppConfig } from './app-config.js';
import { APP_CONFIG_TOKEN, ConfigService } from './config.service.js';

export interface ConfigModuleOptions {
  /** Override the env-input (defaults to `process.env`). Useful for tests. */
  env?: EnvInput;
}

@Global()
@Module({})
export class ConfigModule {
  static forRoot(options: ConfigModuleOptions = {}): DynamicModule {
    const env = options.env ?? (process.env as EnvInput);
    const cfg = loadAppConfig(env);

    return {
      module: ConfigModule,
      providers: [
        { provide: APP_CONFIG_TOKEN, useValue: cfg },
        ConfigService,
      ],
      exports: [ConfigService, APP_CONFIG_TOKEN],
    };
  }
}
