import { NotFoundException } from "@nestjs/common";

import { loadFeatures } from "../features/features.js";
import { serverConfigFromEnv } from "../server/server-config.js";
import { type HubSurfaceTier, isHubSurfaceAvailable } from "./hub-surface-policy.js";

/**
 * Thin runner for `isHubSurfaceAvailable()` — the successor of the
 * scattered per-controller `assertDev()` helpers.
 *
 * Reads the env at REQUEST time (not boot time) on purpose: this is the
 * convention `hub.controller.ts` always used, it is what the
 * NODE_ENV-flipping production e2e specs rely on, and it means a real
 * deployment (env set before process start) and the test harness agree.
 *
 * Throws the same bare `NotFoundException` the old asserts threw, so an
 * unavailable surface stays indistinguishable from a route that does
 * not exist.
 */
export function assertHubSurfaceAvailable(
  tier: HubSurfaceTier,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): void {
  if (!isHubSurfaceAvailableFromEnv(tier, env)) {
    throw new NotFoundException();
  }
}

/**
 * Boolean twin of `assertHubSurfaceAvailable` — same request-time env
 * read, no throw. Feeds availability into payloads instead of gates:
 * `portal-access.json → workstation` and the palette page filter, so
 * the SPA hides surfaces the server would 404 anyway.
 */
export function isHubSurfaceAvailableFromEnv(
  tier: HubSurfaceTier,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): boolean {
  const serverEnv = serverConfigFromEnv(env).env;
  const hubEnabled = loadFeatures(env).hub.enabled;
  return isHubSurfaceAvailable({ env: serverEnv, hubEnabled, tier });
}
