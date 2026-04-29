#!/usr/bin/env bun
/**
 * `bun run sync:from-template` — pulls upstream `src/core/` updates
 * from a local template-repo checkout into the current project,
 * leaving `src/modules/` untouched.
 *
 * Usage:
 *   bun run sync:from-template <path-to-template-repo>
 *
 * The script reads `src/core/**` from both the template repo (the
 * argument) and the local cwd, hands them to the pure planner
 * `planSyncFromTemplate()`, and applies the resulting create/update/
 * delete operations to disk.
 *
 * Defense-in-depth: the planner refuses any path outside `src/core/`,
 * so even a malformed template snapshot can't smuggle writes into
 * `src/modules/`.
 */
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { readdirSync } from 'node:fs';

import { planSyncFromTemplate } from '../src/core/setup/sync-from-template.js';

const templatePath = process.argv[2];
if (!templatePath) {
  console.error('Usage: bun run sync:from-template <path-to-template-repo>');
  process.exit(2);
}
if (!existsSync(templatePath)) {
  console.error(`[sync:from-template] template path does not exist: ${templatePath}`);
  process.exit(1);
}

const TEMPLATE_CORE = resolve(templatePath, 'src/core');
const LOCAL_CORE = resolve(process.cwd(), 'src/core');
if (!existsSync(TEMPLATE_CORE)) {
  console.error(`[sync:from-template] template has no src/core/ at ${TEMPLATE_CORE}`);
  process.exit(1);
}

const templateCore = walk(TEMPLATE_CORE, TEMPLATE_CORE);
const local = walk(LOCAL_CORE, LOCAL_CORE);

const plan = planSyncFromTemplate({ templateCore, local });

console.log(`[sync:from-template] create=${plan.summary.create} update=${plan.summary.update} skip=${plan.summary.skip} delete=${plan.summary.delete}`);

for (const op of plan.create) {
  const absolute = resolve(process.cwd(), op.path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, op.content, 'utf8');
  console.log(`  + ${op.path}`);
}
for (const op of plan.update) {
  const absolute = resolve(process.cwd(), op.path);
  writeFileSync(absolute, op.content, 'utf8');
  console.log(`  M ${op.path}`);
}
for (const path of plan.delete) {
  const absolute = resolve(process.cwd(), path);
  if (existsSync(absolute)) {
    unlinkSync(absolute);
    console.log(`  - ${path}`);
  }
}

console.log('[sync:from-template] done. Review the diff and commit.');

function walk(root: string, base: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      const sub = walk(fullPath, base);
      for (const [k, v] of Object.entries(sub)) out[k] = v;
    } else if (entry.isFile()) {
      const stats = statSync(fullPath);
      if (stats.size > 1_048_576) continue; // skip files > 1 MB
      const rel = relative(base, fullPath).replaceAll('\\', '/');
      out[`src/core/${rel}`] = readFileSync(fullPath, 'utf8');
    }
  }
  return out;
}
