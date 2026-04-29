#!/usr/bin/env bun
/**
 * `bun run prepare:schema` — concatenates core + feature Prisma
 * schemas based on the active features and writes the result to
 * `prisma/schema.generated.prisma`.
 *
 * Pure logic: `src/core/setup/schema-concat.ts`. This file does the
 * I/O.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadFeatures } from '../src/core/features/features.js';
import { concatenateSchema } from '../src/core/setup/schema-concat.js';

const ROOT = process.cwd();
const PRISMA_DIR = resolve(ROOT, 'prisma');
const CORE_PATH = resolve(PRISMA_DIR, 'schema.prisma');
const FEATURES_DIR = resolve(PRISMA_DIR, 'features');
const OUTPUT_PATH = resolve(PRISMA_DIR, 'schema.generated.prisma');

if (!existsSync(CORE_PATH)) {
  console.error(`[prepare:schema] missing core schema at ${CORE_PATH}`);
  process.exit(1);
}

const coreSchema = readFileSync(CORE_PATH, 'utf8');

const featureSchemas: Record<string, string> = {};
if (existsSync(FEATURES_DIR)) {
  for (const file of readdirSync(FEATURES_DIR)) {
    const match = /^([a-zA-Z]+)\.prisma$/.exec(file);
    if (!match) continue;
    featureSchemas[match[1]!] = readFileSync(resolve(FEATURES_DIR, file), 'utf8');
  }
}

const features = loadFeatures(process.env as Record<string, string | undefined>);

try {
  const output = concatenateSchema({
    coreSchema,
    featureSchemas: featureSchemas as Parameters<typeof concatenateSchema>[0]['featureSchemas'],
    features,
  });
  writeFileSync(OUTPUT_PATH, output.schema, 'utf8');
  console.log(`[prepare:schema] wrote ${OUTPUT_PATH}`);
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
