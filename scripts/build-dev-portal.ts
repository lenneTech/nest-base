/**
 * Build the Dev-Portal SPA bundle.
 *
 * `bun run build:dev-portal` invokes `Bun.build()` against
 * `src/core/dx/clients/main.tsx` and writes the artifacts to
 * `dist/dev-portal/`. The Nest controller serves them under
 * `/dev/static/*` (404 outside `NODE_ENV=development`).
 *
 * Code-splitting is enabled (`splitting: true`) so the initial
 * bundle stays small — heavy widgets (TipTap, Monaco) added in
 * follow-up issues will land as separate chunks loaded on demand.
 *
 * The token CSS is copied from
 * `src/core/dx/clients/styles/tokens.css` to `dist/dev-portal/tokens.css`
 * so the controller can serve it without going through the bundler
 * (the shell HTML loads it as a `<link rel="stylesheet">`).
 *
 * Watch mode: pass `--watch`. Re-runs on file change. `scripts/dev.ts`
 * launches us in `--watch` so the SPA stays in sync with edits.
 */
import { existsSync, mkdirSync, watch as watchFs, copyFileSync, statSync, rmSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import tailwindPlugin from "bun-plugin-tailwind";

const repoRoot = process.cwd();
const entry = resolve(repoRoot, "src/core/dx/clients/main.tsx");
const tokenSrc = resolve(repoRoot, "src/core/dx/clients/styles/tokens.css");
const outdir = resolve(repoRoot, "dist/dev-portal");
const isWatch = process.argv.includes("--watch");

if (!existsSync(entry)) {
  console.log(`[build:dev-portal] entry missing — ${entry} (skipping)`);
  process.exit(0);
}

mkdirSync(outdir, { recursive: true });

/** Drop stale hashed chunks so lazy imports never 404 or load old code. */
function cleanOutdir(): void {
  if (!existsSync(outdir)) return;
  for (const name of readdirSync(outdir)) {
    rmSync(resolve(outdir, name), { recursive: true, force: true });
  }
}

async function buildOnce(label: string) {
  cleanOutdir();
  mkdirSync(outdir, { recursive: true });
  const started = Date.now();
  const result = await Bun.build({
    entrypoints: [entry],
    outdir,
    target: "browser",
    splitting: true,
    minify: !isWatch,
    sourcemap: isWatch ? "inline" : "none",
    plugins: [tailwindPlugin],
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    if (!isWatch) process.exit(1);
    return;
  }

  // Token CSS is hand-rolled (no `@import` from JS) — copy it as-is.
  copyFileSync(tokenSrc, resolve(outdir, "tokens.css"));

  let totalBytes = 0;
  for (const out of result.outputs) {
    try {
      totalBytes += statSync(out.path).size;
    } catch {
      /* the output may be virtual; skip */
    }
  }
  const ms = Date.now() - started;
  console.log(
    `[build:dev-portal] ${label} ${result.outputs.length} artifact(s) (${formatBytes(totalBytes)}) in ${ms}ms → ${outdir}`,
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}kB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

await buildOnce("built");

if (!isWatch) {
  process.exit(0);
}

console.log("[build:dev-portal] watching src/core/dx/clients/ …");
const watchDir = resolve(repoRoot, "src/core/dx/clients");
let pending: ReturnType<typeof setTimeout> | undefined;

watchFs(watchDir, { recursive: true }, () => {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    void buildOnce("rebuilt");
  }, 100);
});
