import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildDevPortalShellInput,
  renderDevPortalShell,
} from "../../src/core/dx/dev-portal-shell.js";

/**
 * Story · the portal presents itself as "Hub" — nothing else.
 *
 * Consolidation phase 2: the user-facing branding was a mix of
 * "Dev Portal", "Dev-Hub", and "DevHub". Everything a human READS in
 * the UI now says "Hub". Deliberately NOT renamed (internal
 * identifiers, not user-facing): build scripts (`build:dev-portal`),
 * dist paths (`dist/dev-portal`), file names (`dev-portal-shell.ts`),
 * component/class names (`DevPortalRouteError`), log prefixes
 * (`[dev-portal]`), `@Public()` reasons, and code comments.
 *
 * Two locks:
 *   1. rendered shell HTML — the default <title> and the whole
 *      skeleton carry no legacy branding
 *   2. SPA source scan — no string literal / JSX text in
 *      `src/core/dx/clients/` contains the legacy names (comments,
 *      import lines, and the identifier/log allowlist are stripped
 *      before matching)
 */

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const CLIENTS_DIR = resolve(REPO_ROOT, "src/core/dx/clients");

const LEGACY_BRANDING = /dev[\s-]?portal|dev[\s-]?hub|devhub/i;

/** Non-user-facing occurrences that stay: identifiers + log/error prefixes. */
const ALLOWED_PATTERNS: RegExp[] = [
  /DevPortalRouteError/g, // component / class identifier + import specifier
  /\[dev-portal\]/g, // console log prefix (not rendered UI)
  /"dev-portal: [^"]*"/g, // internal Error() message prefix (main.tsx mount guard)
];

function listClientSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listClientSources(full));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Strip comments + import/export-from lines — non-rendered text. */
function strippedSource(path: string): string {
  let src = readFileSync(path, "utf8");
  src = src.replace(/\/\*[\s\S]*?\*\//g, "");
  src = src.replace(/^\s*\/\/.*$/gm, "");
  src = src.replace(/^\s*(import|export)[^;]*from\s+"[^"]+";?\s*$/gm, "");
  for (const pattern of ALLOWED_PATTERNS) {
    src = src.replace(pattern, "");
  }
  return src;
}

describe("Story · Hub branding lock (no user-facing Dev-Portal strings)", () => {
  it("the default shell <title> is Hub", () => {
    const html = renderDevPortalShell(buildDevPortalShellInput({}));
    expect(html).toContain("<title>Hub — nest-server</title>");
  });

  it("the rendered shell skeleton carries no legacy branding", () => {
    const html = renderDevPortalShell(buildDevPortalShellInput({}));
    expect(html).not.toMatch(LEGACY_BRANDING);
  });

  it("hub.controller.ts titles say Hub, not Dev Portal", () => {
    const src = readFileSync(resolve(REPO_ROOT, "src/core/dx/hub.controller.ts"), "utf8");
    expect(src).not.toContain('title: "Dev Portal"');
    expect(src).toContain('title: "Hub"');
  });

  it("no SPA source ships a legacy-branded string or JSX text", () => {
    const offenders: string[] = [];
    for (const file of listClientSources(CLIENTS_DIR)) {
      const stripped = strippedSource(file);
      const match = stripped.match(LEGACY_BRANDING);
      if (match) {
        offenders.push(`${file.replace(`${REPO_ROOT}/`, "")} → "${match[0]}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
