#!/usr/bin/env bun
/**
 * `bun run setup` — generate a `.env` from `.env.example`, substituting
 * placeholders with cryptographically random secrets. Idempotent: if
 * `.env` already exists the runner refuses to overwrite it.
 *
 * Pure logic lives in src/core/setup/setup-wizard-runner.ts; this file
 * is just the thin CLI surface (cwd + stdout logging + exit code).
 */

import { runSetupWizard } from '../src/core/setup/setup-wizard-runner.js';

const result = runSetupWizard({
  projectRoot: process.cwd(),
  logger: {
    info: (msg) => console.log(`[setup] ${msg}`),
    warn: (msg) => console.warn(`[setup] ${msg}`),
  },
});

if (!result.created) {
  process.exit(1);
}

console.log('');
console.log('Next steps:');
console.log('  1. Review and adjust values in .env');
console.log('  2. Start dependencies: docker compose up -d');
console.log('  3. Run migrations:     bun run prisma:migrate');
console.log('  4. Boot the server:    bun run dev');
