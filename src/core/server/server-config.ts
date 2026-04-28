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
  /**
   * Public base URL of the server. Renamed from `BASE_URL` to avoid the
   * clash with Vite/Vitest, which auto-sets `process.env.BASE_URL = '/'`.
   * `BASE_URL` is also accepted as a fallback for legacy configs.
   */
  APP_BASE_URL?: string;
  BASE_URL?: string;
  NODE_ENV?: string;
}

export function serverConfigFromEnv(env: ServerEnvInput): ServerConfig {
  const portRaw = present(env.PORT);
  const port = portRaw === undefined ? DEFAULT_PORT : parseTcpPort(portRaw);

  const candidate = {
    port,
    host: present(env.HOST) ?? DEFAULT_HOST,
    baseUrl: present(env.APP_BASE_URL) ?? presentValidBaseUrl(env.BASE_URL) ?? DEFAULT_BASE_URL,
    // `test` is the implicit NODE_ENV under vitest. Treat it as `development`
    // for config purposes — tests get dev-friendly defaults (insecure cookies,
    // localhost CORS) without us having to expand the AppEnv union.
    env: normalizeAppEnv(present(env.NODE_ENV)),
  };

  return ServerConfigSchema.parse(candidate);
}

/** Vite/Vitest set `BASE_URL='/'` automatically. Discard those values; only
 *  accept BASE_URL when it parses as a real URL. */
function presentValidBaseUrl(value: string | undefined): string | undefined {
  const v = present(value);
  if (v === undefined) return undefined;
  try {
    new URL(v);
    return v;
  } catch {
    return undefined;
  }
}

function normalizeAppEnv(raw: string | undefined): AppEnv {
  if (raw === undefined || raw === 'test') return DEFAULT_ENV;
  return raw as AppEnv;
}

/** Treat empty strings the same as undefined — many CI runners surface unset
 *  env-vars as empty rather than missing keys. */
function present(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

function parseTcpPort(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`PORT must be an integer (received: ${raw})`);
  }
  return n;
}
