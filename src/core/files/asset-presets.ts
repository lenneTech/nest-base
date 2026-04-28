import { z } from 'zod';

import type { TransformOptions } from './asset.service.js';

/**
 * Asset Presets (PLAN.md §8 + §32 Phase 4).
 *
 * Named transform profiles that limit valid request URLs and keep
 * the cache hot. Projects extend the framework defaults via
 * `registry.register(name, opts)` without forking the asset service.
 */

const FORMATS = ['webp', 'jpeg', 'png', 'avif'] as const;
const FITS = ['cover', 'contain', 'inside', 'outside'] as const;

export const AssetPresetSchema = z.object({
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  format: z.enum(FORMATS).optional(),
  quality: z.number().int().min(1).max(100).optional(),
  fit: z.enum(FITS).optional(),
});

export type AssetPreset = TransformOptions;

export const DEFAULT_ASSET_PRESETS: Record<string, AssetPreset> = {
  thumbnail: { width: 200, height: 200, format: 'webp', fit: 'cover', quality: 75 },
  avatar: { width: 400, height: 400, format: 'webp', fit: 'cover', quality: 80 },
  hero: { width: 1920, height: 1080, format: 'webp', fit: 'cover', quality: 80 },
};

export class AssetPresetNotFoundError extends Error {
  constructor(public readonly name: string) {
    super(`asset preset not found: ${name}`);
    this.name = 'AssetPresetNotFoundError';
  }
}

export class AssetPresetRegistry {
  private readonly presets = new Map<string, AssetPreset>();

  register(name: string, preset: AssetPreset): void {
    if (this.presets.has(name)) {
      throw new Error(`asset preset registry: duplicate name "${name}"`);
    }
    const validated = AssetPresetSchema.parse(preset);
    this.presets.set(name, validated);
  }

  get(name: string): AssetPreset {
    const preset = this.presets.get(name);
    if (!preset) throw new AssetPresetNotFoundError(name);
    return preset;
  }

  has(name: string): boolean {
    return this.presets.has(name);
  }

  static fromDefaults(): AssetPresetRegistry {
    const reg = new AssetPresetRegistry();
    for (const [name, preset] of Object.entries(DEFAULT_ASSET_PRESETS)) {
      reg.register(name, preset);
    }
    return reg;
  }
}
