/**
 * Build entry-point.
 *
 * Skips silently if `src/main.ts` does not yet exist — the entry point is
 * created in the "Projekt-Skeleton" slice. Until then `bun run build` is a
 * no-op so CI / quality-gates pass on empty repos.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const entry = resolve(process.cwd(), 'src/main.ts');

if (!existsSync(entry)) {
  console.log('[build] src/main.ts not present yet — skipping bundling.');
  process.exit(0);
}

const result = await Bun.build({
  entrypoints: [entry],
  outdir: resolve(process.cwd(), 'dist'),
  target: 'bun',
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`[build] wrote ${result.outputs.length} artifact(s) to ./dist`);
