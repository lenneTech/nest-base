import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import * as React from "react";
import { render, toPlainText } from "@react-email/render";

import { defaultBrandConfig, type BrandConfig } from "./brand.js";
import type { EmailRenderedTemplate, EmailTemplateRenderer } from "./email.service.js";

/**
 * React-Email template loader + renderer.
 *
 * Templates live as `.tsx` files on disk:
 *   - `src/core/email/templates/<name>.tsx`            — built-ins
 *   - `src/modules/email/templates/<name>.tsx`         — project overlay
 *   - `src/{core,modules}/email/templates/<name>.<locale>.tsx` — locale variants
 *
 * Resolution order:
 *   1. `<name>.<locale>.tsx` from the module overlay
 *   2. `<name>.<locale>.tsx` from core
 *   3. `<name>.tsx` from the module overlay
 *   4. `<name>.tsx` from core
 *
 * Discovery enumerates both folders at boot. The render path imports
 * the matching module dynamically, calls the default export with the
 * supplied vars, hands the React tree to `@react-email/render`, and
 * extracts the subject from the named `<name>Meta.subject(vars)`
 * factory.
 *
 * The planner half (path resolution) is exposed as
 * `discoverReactEmailTemplates()` so tests can verify discovery
 * without spinning up the renderer.
 */

export class ReactEmailTemplateNotFoundError extends Error {
  constructor(name: string, locale: string) {
    super(`react-email-templates: template "${name}" (locale="${locale}") not found`);
    this.name = "ReactEmailTemplateNotFoundError";
  }
}

export class ReactEmailTemplateInvalidError extends Error {
  constructor(file: string, reason: string) {
    super(`react-email-templates: template "${file}" is invalid: ${reason}`);
    this.name = "ReactEmailTemplateInvalidError";
  }
}

export interface DiscoveredTemplate {
  /** Template basename (file stem with the locale suffix stripped). */
  name: string;
  /** Optional locale suffix (e.g. "de" for `password-reset.de.tsx`). */
  locale: string | null;
  /** Absolute path to the .tsx file. */
  file: string;
  /** Where the file was discovered — `module` overrides `core`. */
  source: "core" | "module";
}

export interface DiscoverOptions {
  /** Project root; defaults to `process.cwd()`. */
  projectRoot?: string;
  /** Override the core templates directory (used by tests). */
  coreDir?: string;
  /** Override the module templates directory (used by tests). */
  moduleDir?: string;
}

const TEMPLATE_FILE_RE = /^([a-z0-9][a-z0-9-]*)(?:\.([a-z]{2}(?:-[A-Z]{2})?))?\.tsx$/;

/**
 * Discovers every `.tsx` template under the core + module folders.
 * Pure function — no dynamic imports, just path enumeration. The
 * runner (`ReactEmailTemplateRenderer.render`) calls this to build
 * its lookup map.
 */
export async function discoverReactEmailTemplates(
  options: DiscoverOptions = {},
): Promise<DiscoveredTemplate[]> {
  const root = options.projectRoot ?? process.cwd();
  const coreDir = options.coreDir ?? resolve(root, "src/core/email/templates");
  const moduleDir = options.moduleDir ?? resolve(root, "src/modules/email/templates");

  const out: DiscoveredTemplate[] = [];
  for (const file of listTsxFiles(coreDir)) {
    const parsed = parseTemplateFilename(file);
    if (!parsed) continue;
    out.push({
      name: parsed.name,
      locale: parsed.locale,
      file: join(coreDir, file),
      source: "core",
    });
  }
  for (const file of listTsxFiles(moduleDir)) {
    const parsed = parseTemplateFilename(file);
    if (!parsed) continue;
    out.push({
      name: parsed.name,
      locale: parsed.locale,
      file: join(moduleDir, file),
      source: "module",
    });
  }
  return out;
}

function listTsxFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  if (!statSync(dir).isDirectory()) return [];
  return readdirSync(dir).filter((entry) => entry.endsWith(".tsx"));
}

function parseTemplateFilename(file: string): { name: string; locale: string | null } | null {
  const match = TEMPLATE_FILE_RE.exec(file);
  if (!match) return null;
  return { name: match[1] ?? "", locale: match[2] ?? null };
}

export interface ReactEmailTemplateRendererOptions {
  /** Brand config injected into every template's <Barebone> wrapper. */
  brand?: BrandConfig;
  /** Project root for discovery; defaults to `process.cwd()`. */
  projectRoot?: string;
  /** Override the core templates directory (used by tests). */
  coreDir?: string;
  /** Override the module templates directory (used by tests). */
  moduleDir?: string;
}

interface TemplateModule {
  default: (props: object) => React.ReactElement;
  // Subject factory exported as `<name>Meta`. Indexed via convention.
  [key: string]: unknown;
}

export class ReactEmailTemplateRenderer implements EmailTemplateRenderer {
  private readonly brand: BrandConfig;
  private readonly projectRoot: string;
  private readonly coreDir: string;
  private readonly moduleDir: string;
  /**
   * Per-file in-flight import promise cache (iter-149). The natural
   * ESM module cache deduplicates by URL once a module is fully
   * loaded, but Node's dynamic-import resolver can race across
   * concurrent first-time loads of the same URL when many test
   * workers hit the same template path simultaneously. Holding a
   * promise per resolved file path makes the dedup explicit and
   * eliminates the residual flake observed in iter-148. Keyed by
   * the resolved URL string so dev-mode cache-bust queries don't
   * collapse onto each other.
   */
  private readonly importCache = new Map<string, Promise<TemplateModule>>();

  constructor(options: ReactEmailTemplateRendererOptions = {}) {
    this.brand = options.brand ?? defaultBrandConfig();
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.coreDir = options.coreDir ?? resolve(this.projectRoot, "src/core/email/templates");
    this.moduleDir = options.moduleDir ?? resolve(this.projectRoot, "src/modules/email/templates");
  }

  async render(template: string, locale: string, vars: object): Promise<EmailRenderedTemplate> {
    const resolved = this.resolveFile(template, locale);
    if (!resolved) throw new ReactEmailTemplateNotFoundError(template, locale);

    const mod = await this.importTemplate(resolved.file);
    const Component = mod.default;
    if (typeof Component !== "function") {
      throw new ReactEmailTemplateInvalidError(resolved.file, "missing default export");
    }
    const meta = pickMeta(mod, template);
    if (!meta) {
      throw new ReactEmailTemplateInvalidError(
        resolved.file,
        `missing exported subject factory (expected "${metaExportName(template)}.subject")`,
      );
    }

    const props = { ...(vars as Record<string, unknown>), brand: this.brand };
    const element = Component(props);
    const html = await render(element);
    const text = toPlainText(html);
    // The meta.subject factory is typed against a per-template Vars
    // shape; the renderer holds `vars` as the open `Record<string,
    // unknown>`. Bridge through a typed `unknown` intermediate to
    // the factory's parameter shape.
    type SubjectArg = Parameters<typeof meta.subject>[0];
    const subjectArgErased: unknown = vars;
    const subject = meta.subject(subjectArgErased as SubjectArg);
    return { subject, html, text };
  }

  private resolveFile(name: string, locale: string): { file: string } | null {
    // Lookup precedence (best match wins):
    //   1. module / locale-specific
    //   2. core / locale-specific
    //   3. module / default
    //   4. core / default
    const candidates = [
      join(this.moduleDir, `${name}.${locale}.tsx`),
      join(this.coreDir, `${name}.${locale}.tsx`),
      join(this.moduleDir, `${name}.tsx`),
      join(this.coreDir, `${name}.tsx`),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return { file: candidate };
    }
    return null;
  }

  private async importTemplate(file: string): Promise<TemplateModule> {
    // Only cache-bust in development so `bun --watch` reloads pick up
    // template edits. In production / test the natural ESM cache is
    // both correct (nothing reloads templates) and faster — the
    // cache-buster used to force one fresh evaluation per call,
    // which under heavy parallel-test pressure can race the dynamic
    // import resolver and produce intermittent `module not found`
    // errors at the per-test boundary.
    const baseUrl = pathToFileURL(file).href;
    const url = process.env.NODE_ENV === "development" ? `${baseUrl}?t=${Date.now()}` : baseUrl;
    // Promise-cache: dedupe concurrent first-time imports of the
    // same URL. On error the promise is evicted so the next caller
    // gets a fresh chance (the original race was at the resolver
    // level, not in the module body).
    const cached = this.importCache.get(url);
    if (cached !== undefined) return cached;
    const promise = (async () => {
      try {
        return (await import(url)) as TemplateModule;
      } catch (err) {
        this.importCache.delete(url);
        throw err;
      }
    })();
    this.importCache.set(url, promise);
    return promise;
  }
}

function metaExportName(templateName: string): string {
  // password-reset → passwordResetMeta
  return (
    templateName
      .split("-")
      .map((seg, i) => (i === 0 ? seg : seg.charAt(0).toUpperCase() + seg.slice(1)))
      .join("") + "Meta"
  );
}

interface MetaShape {
  name: string;
  subject: (vars: never) => string;
}

function pickMeta(mod: TemplateModule, templateName: string): MetaShape | null {
  const exportName = metaExportName(templateName);
  const candidate = mod[exportName] as MetaShape | undefined;
  if (candidate && typeof candidate.subject === "function") return candidate;
  return null;
}
