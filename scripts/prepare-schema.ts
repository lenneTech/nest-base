#!/usr/bin/env bun
/**
 * `bun run prepare:schema` — concatenates core + feature Prisma
 * schemas based on the active features and writes the result to
 * `prisma/schema.generated.prisma`. Also materialises feature-gated
 * migrations (e.g. PostGIS for `geo`) into `prisma/migrations/` when
 * the feature is enabled, so `prisma migrate deploy` sees the right
 * set without depending on an extension that isn't installed.
 *
 * Pure logic: `src/core/setup/schema-concat.ts` and
 * `src/core/setup/feature-migrations.ts`. This file does the I/O.
 */
import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadFeatures } from '../src/core/features/features.js';
import {
  type FeatureMigrationDir,
  planFeatureMigrationSync,
} from '../src/core/setup/feature-migrations.js';
import { concatenateSchema } from '../src/core/setup/schema-concat.js';

const ROOT = process.cwd();
const PRISMA_DIR = resolve(ROOT, 'prisma');
const CORE_PATH = resolve(PRISMA_DIR, 'schema.prisma');
const FEATURES_DIR = resolve(PRISMA_DIR, 'features');
const MIGRATIONS_DIR = resolve(PRISMA_DIR, 'migrations');
const OUTPUT_PATH = resolve(PRISMA_DIR, 'schema.generated.prisma');

const CHECK_MODE = process.argv.includes('--check');

if (!existsSync(CORE_PATH)) {
  console.error(`[prepare:schema] missing core schema at ${CORE_PATH}`);
  process.exit(1);
}

const coreSchema = readFileSync(CORE_PATH, 'utf8');

const featureSchemas: Record<string, string> = {};
const availableFeatureMigrations: FeatureMigrationDir[] = [];

if (existsSync(FEATURES_DIR)) {
  for (const entry of readdirSync(FEATURES_DIR)) {
    // Schema files: `<feature>.prisma` — concatenated into the generated schema.
    const schemaMatch = /^([a-zA-Z]+)\.prisma$/.exec(entry);
    if (schemaMatch) {
      featureSchemas[schemaMatch[1]!] = readFileSync(resolve(FEATURES_DIR, entry), 'utf8');
      continue;
    }
    // Feature directories: `<feature>/migrations/<timestamp>_<name>/migration.sql`.
    // Only opt in when the layout matches; ignore anything else.
    const featurePath = resolve(FEATURES_DIR, entry);
    if (!statSync(featurePath).isDirectory()) continue;
    const migrationsPath = resolve(featurePath, 'migrations');
    if (!existsSync(migrationsPath)) continue;
    for (const dirName of readdirSync(migrationsPath)) {
      const migrationPath = resolve(migrationsPath, dirName);
      if (!statSync(migrationPath).isDirectory()) continue;
      if (!existsSync(resolve(migrationPath, 'migration.sql'))) continue;
      availableFeatureMigrations.push({ feature: entry, name: dirName });
    }
  }
}

const features = loadFeatures(process.env as Record<string, string | undefined>);

try {
  const output = concatenateSchema({
    coreSchema,
    featureSchemas: featureSchemas as Parameters<typeof concatenateSchema>[0]['featureSchemas'],
    features,
  });
  if (CHECK_MODE) {
    // --check mode: verify the committed file matches what we would write.
    // Exit 0 when in sync, 1 on drift. Never modify the generated file.
    const committed = existsSync(OUTPUT_PATH) ? readFileSync(OUTPUT_PATH, 'utf8') : '';
    if (committed === output.schema) {
      console.log(`[prepare:schema] no drift — ${OUTPUT_PATH} matches concatenated source`);
    } else {
      console.error(
        `[prepare:schema] drift detected — ${OUTPUT_PATH} diverges from concatenated source`,
      );
      console.error(`[prepare:schema] run \`bun run prepare:schema\` to refresh the file`);
      process.exit(1);
    }
  } else {
    writeFileSync(OUTPUT_PATH, output.schema, 'utf8');
    console.log(`[prepare:schema] wrote ${OUTPUT_PATH}`);
  }
  if (output.includedFeatures.length > 0) {
    console.log(`[prepare:schema] included features: ${output.includedFeatures.join(', ')}`);
  } else {
    console.log('[prepare:schema] no feature schemas active (core only)');
  }
  // Features that are enabled but have no .prisma file — runtime-only
  // toggles like mcp, realtime, fieldEncryption, or webhooks (whose
  // tables ship in the core schema). Surface them so a user notices
  // a misnamed file.
  if (output.skippedFeatures.length > 0) {
    console.log(
      `[prepare:schema] runtime-only features (no schema file expected): ${output.skippedFeatures.join(', ')}`,
    );
  }
} catch (err) {
  console.error(`[prepare:schema] ${(err as Error).message}`);
  process.exit(1);
}

// In --check mode, skip migration sync — the gate is purely about
// schema-file drift. Migrations can stay in sync via the runner mode.
if (CHECK_MODE) {
  process.exit(0);
}

// Sync feature-gated migrations into prisma/migrations/ when the feature is on.
// We don't remove migrations once materialised — a feature that flipped on at
// some point left state in the DB, and `prisma migrate deploy` complains about
// recorded-but-missing migrations.
const migrationPlan = planFeatureMigrationSync({
  features,
  available: availableFeatureMigrations,
});

for (const step of migrationPlan.sync) {
  const src = resolve(ROOT, step.fromRelative);
  const dest = resolve(ROOT, step.toRelative);
  if (existsSync(dest)) continue;
  cpSync(src, dest, { recursive: true });
  console.log(`[prepare:schema] materialised ${step.toRelative} (feature: ${step.feature})`);
}

if (migrationPlan.skipped.length > 0) {
  const grouped = new Map<string, string[]>();
  for (const skip of migrationPlan.skipped) {
    if (!grouped.has(skip.feature)) grouped.set(skip.feature, []);
    grouped.get(skip.feature)!.push(skip.name);
  }
  for (const [feature, names] of grouped) {
    console.log(`[prepare:schema] feature "${feature}" is off, skipped migrations: ${names.length}`);
  }
}

// Sanity guard: if `prisma/migrations/` ended up empty (would happen if
// someone deleted the always-on migrations), warn loudly.
if (existsSync(MIGRATIONS_DIR) && readdirSync(MIGRATIONS_DIR).length === 0) {
  console.warn('[prepare:schema] prisma/migrations/ is empty — `bun run prisma:migrate` will be a no-op');
}
