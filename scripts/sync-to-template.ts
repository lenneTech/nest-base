#!/usr/bin/env bun
/**
 * `bun run sync:to-template` — diffs local `src/core/` against a
 * template-repo checkout and prepares a unified patch suitable for
 * `git apply` upstream (PR-back-workflow).
 *
 * Usage:
 *   bun run sync:to-template <path-to-template-repo> [--out patch-file.diff]
 *
 * Default output goes to `reports/sync-to-template.patch`. The script
 * does NOT push or open PRs — it just stages the patch for human
 * review.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { planSyncToTemplate } from '../src/core/setup/sync-to-template.js';

const templatePath = process.argv[2];
if (!templatePath) {
  console.error('Usage: bun run sync:to-template <path-to-template-repo> [--out patch-file]');
  process.exit(2);
}
if (!existsSync(templatePath)) {
  console.error(`[sync:to-template] template path does not exist: ${templatePath}`);
  process.exit(1);
}

const outFlag = process.argv.indexOf('--out');
const outPath =
  outFlag >= 0 && process.argv[outFlag + 1]
    ? resolve(process.cwd(), process.argv[outFlag + 1]!)
    : resolve(process.cwd(), 'reports/sync-to-template.patch');

const TEMPLATE_CORE = resolve(templatePath, 'src/core');
const LOCAL_CORE = resolve(process.cwd(), 'src/core');

const templateCore = walk(TEMPLATE_CORE, TEMPLATE_CORE);
const local = walk(LOCAL_CORE, LOCAL_CORE);

const plan = planSyncToTemplate({ local, templateCore });

console.log(`[sync:to-template] add=${plan.summary.add} modify=${plan.summary.modify} skip=${plan.summary.skip} remove=${plan.summary.remove}`);

mkdirSync(dirname(outPath), { recursive: true });
const patch = plan.renderUnifiedPatch();
writeFileSync(outPath, patch, 'utf8');
console.log(`[sync:to-template] wrote patch → ${outPath}`);
console.log('Apply upstream with: cd <template> && git apply <patch-file>');

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
      if (stats.size > 1_048_576) continue;
      const rel = relative(base, fullPath).replaceAll('\\', '/');
      out[`src/core/${rel}`] = readFileSync(fullPath, 'utf8');
    }
  }
  return out;
}
