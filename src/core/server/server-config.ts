import { z } from 'zod';

import type { AppEnv } from '../http/cookie-cors-config.js';

/**
 * Server boot config (Phase 1).
 *
 * The actual NestJS app reads this in the next slice (`Projekt-Skeleton`).
 * `serverConfigFromEnv()` is the env-vars adapter and applies dev defaults.
 */

const APP_ENV_VALUES = ['development', 'staging', 'production'] as const;

export const ServerConfigSchema = z.object({
  port: z.number().int().min(1).max(65_535),
  host: z.string().min(1),
  baseUrl: z.url(),
  env: z.enum(APP_ENV_VALUES),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_BASE_URL = `http://localhost:${DEFAULT_PORT}`;
const DEFAULT_ENV: AppEnv = 'development';

export function defaultServerConfig(): ServerConfig {
  return {
    port: DEFAULT_PORT,
    host: DEFAULT_HOST,
    baseUrl: DEFAULT_BASE_URL,
    env: DEFAULT_ENV,
  };
}

export interface ServerEnvInput {
  PORT?: string;
  HOST?: string;
  BASE_URL?: string;
  NODE_ENV?: string;
}

export function serverConfigFromEnv(env: ServerEnvInput): ServerConfig {
  const portRaw = env.PORT;
  const port = portRaw === undefined ? DEFAULT_PORT : parseTcpPort(portRaw);

  const candidate = {
    port,
    host: env.HOST ?? DEFAULT_HOST,
    baseUrl: env.BASE_URL ?? DEFAULT_BASE_URL,
    env: (env.NODE_ENV as AppEnv | undefined) ?? DEFAULT_ENV,
  };

  return ServerConfigSchema.parse(candidate);
}

function parseTcpPort(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`PORT must be an integer (received: ${raw})`);
  }
  return n;
}
