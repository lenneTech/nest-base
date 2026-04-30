import type { Features } from "../features/features.js";

/**
 * Feature-gated migration sync planner.
 *
 * Some Prisma migrations only make sense when a specific feature is
 * enabled — e.g. PostGIS extension + GIST indexes for `geo`. They
 * cannot live in `prisma/migrations/` unconditionally because they
 * depend on extensions that may not exist (PostGIS is missing on the
 * default `postgres:*-alpine` image, and pre-creating it on every
 * project is unwanted overhead).
 *
 * Layout:
 *
 *   prisma/features/<feature>/migrations/<timestamp>_<name>/migration.sql
 *
 * When a feature is enabled, its migration directories are materialised
 * into `prisma/migrations/` so Prisma sees them. When it stays disabled,
 * they're never materialised and the DB never installs the extension.
 *
 * The planner returns a deterministic plan; the runner side performs
 * the file-system copies. No I/O here.
 */

export interface FeatureMigrationDir {
  /** Feature key from `features.ts`, e.g. "geo". */
  feature: string;
  /** Migration directory name, e.g. "20260428000200_postgis_extension". */
  name: string;
}

export interface FeatureMigrationSyncInput {
  features: Features;
  /** Discovered `<feature>/<migration-dir>` pairs from disk. */
  available: FeatureMigrationDir[];
}

export interface FeatureMigrationSyncStep {
  feature: string;
  name: string;
  /** Source path relative to project root. */
  fromRelative: string;
  /** Destination path relative to project root. */
  toRelative: string;
}

export interface FeatureMigrationSyncPlan {
  /** Migrations to materialise (feature is enabled, dir not yet present). */
  sync: FeatureMigrationSyncStep[];
  /** Migrations skipped because the feature is disabled. */
  skipped: FeatureMigrationDir[];
}

export function planFeatureMigrationSync(
  input: FeatureMigrationSyncInput,
): FeatureMigrationSyncPlan {
  const sync: FeatureMigrationSyncStep[] = [];
  const skipped: FeatureMigrationDir[] = [];

  for (const dir of input.available) {
    const enabled = isFeatureEnabled(input.features, dir.feature);
    if (enabled) {
      sync.push({
        feature: dir.feature,
        name: dir.name,
        fromRelative: `prisma/features/${dir.feature}/migrations/${dir.name}`,
        toRelative: `prisma/migrations/${dir.name}`,
      });
    } else {
      skipped.push(dir);
    }
  }

  // Deterministic order: by destination dir name (which embeds the
  // timestamp prefix). Prisma applies them lexicographically anyway.
  sync.sort((a, b) => a.name.localeCompare(b.name));
  skipped.sort((a, b) => a.name.localeCompare(b.name));

  return { sync, skipped };
}

function isFeatureEnabled(features: Features, key: string): boolean {
  const block = (features as Record<string, unknown>)[key] as { enabled?: boolean } | undefined;
  return block?.enabled === true;
}
