import { NotFoundException } from "@nestjs/common";

import { isFeatureActive } from "../dx/feature-catalog.js";
import { loadFeatures, type Features, type ToggleableFeatureKey } from "./features.js";

/** Throw 404 when a toggleable feature is off (matches tenant-admin gating). */
export function assertFeatureEnabled(features: Features, key: ToggleableFeatureKey): void {
  if (!isFeatureActive(features, key)) {
    throw new NotFoundException();
  }
}

export function assertFeatureEnabledFromEnv(
  key: ToggleableFeatureKey,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): void {
  assertFeatureEnabled(loadFeatures(env), key);
}
