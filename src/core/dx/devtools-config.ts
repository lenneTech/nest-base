/**
 * NestJS DevTools config (PLAN.md §27.1 + §32 Phase 8).
 *
 * Pure builder for the `DevtoolsModule.register()` options bag plus
 * the `NestFactory.create({ snapshot })` flag. Bootstrap reads the
 * resulting object and either wires the module + sets the snapshot
 * flag (`enabled === true`) or skips both entirely (footprint-zero
 * in production).
 *
 * Defaults track PLAN.md §27.1: dev=on, prod=off, test=off. Apps
 * override via the input — common production case is `enabled: true`
 * with `http: false` for snapshot-only diagnostics behind an admin
 * gate.
 */

export type DevToolsEnv = "development" | "production" | "test";

export interface DevToolsConfigInput {
  /** Master switch. When omitted, derives from `env`. */
  enabled?: boolean;
  /** App environment — drives the `enabled` default when not set. */
  env: DevToolsEnv;
  /** Port for the DevTools HTTP transport. Default 8000. */
  port?: number;
  /** Enable the HTTP transport (the standalone Cloud DevTools UI uses it). */
  http?: boolean;
  /** Enable graph-snapshot mode in NestFactory.create({ snapshot }). */
  snapshot?: boolean;
}

export interface DevToolsConfig {
  enabled: boolean;
  port: number;
  http: boolean;
  snapshot: boolean;
}

const DEFAULT_PORT = 8000;
const VALID_ENVS: DevToolsEnv[] = ["development", "production", "test"];

export function buildDevToolsConfig(input: DevToolsConfigInput): DevToolsConfig {
  if (!VALID_ENVS.includes(input.env)) {
    throw new Error(
      `devtools-config: env must be one of ${VALID_ENVS.join(", ")} (got "${input.env}")`,
    );
  }
  const port = input.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`devtools-config: port must be an integer in [1, 65535] (got ${port})`);
  }
  const enabled = input.enabled ?? input.env === "development";
  return {
    enabled,
    port,
    http: input.http ?? true,
    snapshot: input.snapshot ?? true,
  };
}
