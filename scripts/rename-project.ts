#!/usr/bin/env bun
/**
 * `bun run rename <new-name>` — rename the template to a project-
 * specific name across the four files where the name is hard-coded:
 * `package.json`, `README.md`, `portless.yml`, `docker-compose.yml`.
 *
 * Idempotent. Pure logic lives in
 * `src/core/setup/project-rename.ts`; this file is the thin CLI shim
 * (argv parsing + cwd + stdout logging + exit codes).
 */

import { runProjectRename } from '../src/core/setup/project-rename-runner.js';

const newName = process.argv[2];
if (!newName) {
  console.error('Usage: bun run rename <new-name>');
  console.error('  Example: bun run rename my-app');
  process.exit(2);
}

try {
  const result = runProjectRename({
    projectRoot: process.cwd(),
    newName,
    logger: {
      info: (msg) => console.log(`[rename] ${msg}`),
      warn: (msg) => console.warn(`[rename] ${msg}`),
    },
  });
  if (!result.changed) {
    process.exit(0);
  }
  console.log('');
  console.log('Don\'t forget to commit the rename:');
  console.log('  git add package.json README.md portless.yml docker-compose.yml');
  console.log(`  git commit -m "chore: rename project to ${newName}"`);
} catch (err) {
  console.error(`[rename] ${(err as Error).message}`);
  process.exit(1);
}
