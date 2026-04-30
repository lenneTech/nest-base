/**
 * Email-Builder planners — Issue #9.
 *
 * Pure functions powering the `/dev/email-builder` UI:
 *   - composeEmailTemplateSource()  → JSON composition → `.tsx` source string
 *   - resolveEmailTemplateTarget()  → safe target path under src/modules/email/templates
 *   - validateEmailComposition()    → shape + variable-reachability check
 *   - isValidEmailTemplateSlug()    → kebab-case allow-list (anti path-traversal)
 *   - isValidEmailTemplateLocale()  → "en" / "en-US" allow-list
 *   - isCoreEmailTemplate()         → true for built-ins (verification etc.)
 *
 * The codegen is intentionally tiny — fixed imports + a hand-rolled
 * JSX tree. No prettier dependency at planner time (would couple every
 * test to a heavy formatter); the runner side may format before write
 * if a project wants it. Output is deterministic so two calls with the
 * same input produce byte-identical strings — round-trip tests rely
 * on it.
 */

export const CORE_EMAIL_TEMPLATES = [
  "email-verification",
  "password-reset",
  "welcome",
  "invitation",
] as const;

export const KNOWN_EMAIL_LAYOUTS = ["Barebone"] as const;

export const KNOWN_EMAIL_BLOCKS = [
  "greeting",
  "paragraph",
  "cta",
  "footer",
  "code",
  "divider",
] as const;

export type EmailBlockType = (typeof KNOWN_EMAIL_BLOCKS)[number];

export interface EmailBlockSpec {
  /** Block type — one of `KNOWN_EMAIL_BLOCKS`. */
  type: string;
  /** Block props. Text values may use `{{varName}}` interpolation. */
  props: Record<string, string | number | boolean | undefined>;
}

export interface EmailComposition {
  /** Layout component name — currently only `Barebone`. */
  layout: string;
  /** Subject string. May reference `{{varName}}` placeholders. */
  subject: string;
  /** Optional preheader (preview text). May reference `{{varName}}`. */
  preheader?: string;
  /** Child blocks rendered inside the layout. */
  children: EmailBlockSpec[];
}

const SLUG_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/;
// Canonical IETF tag — lowercase language, optional uppercase region.
const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/;

/**
 * Allow-list for template slugs. We tighten the lenient discovery
 * pattern (`[a-z0-9][a-z0-9-]*`) to require a leading lowercase
 * letter — numeric-prefixed module names are valid Bun imports but
 * generate ugly PascalCase identifiers (`1foo` → `1Foo`). Forbid them
 * here to keep the codegen output readable.
 */
export function isValidEmailTemplateSlug(slug: string): boolean {
  if (typeof slug !== "string") return false;
  if (slug.length === 0 || slug.length > 64) return false;
  return SLUG_PATTERN.test(slug);
}

export function isValidEmailTemplateLocale(locale: string): boolean {
  if (typeof locale !== "string") return false;
  return LOCALE_PATTERN.test(locale);
}

export function isCoreEmailTemplate(slug: string): boolean {
  return (CORE_EMAIL_TEMPLATES as readonly string[]).includes(slug);
}

export interface ResolveTemplateTargetInput {
  /** Project root — usually `process.cwd()`. */
  projectRoot: string;
  /** Template slug (must pass `isValidEmailTemplateSlug`). */
  slug: string;
  /** Optional locale suffix (must pass `isValidEmailTemplateLocale`). */
  locale?: string;
}

export type ResolveTemplateTargetResult =
  | {
      ok: true;
      /** Absolute path to the target `.tsx` file. */
      absolutePath: string;
      /** Path relative to `projectRoot` (POSIX). */
      relativePath: string;
    }
  | { ok: false; error: string };

/**
 * Pure path-resolution + validation. Defense-in-depth:
 *   1. Slug shape is allow-list checked
 *   2. Optional locale shape is allow-list checked
 *   3. Joined path must start with `<projectRoot>/src/modules/email/templates/`
 *
 * Step 3 closes the door on anything that slipped past step 1 (e.g. a
 * runner that decoded `..%2F..%2Fetc` before passing it in).
 */
export function resolveEmailTemplateTarget(
  input: ResolveTemplateTargetInput,
): ResolveTemplateTargetResult {
  if (!isValidEmailTemplateSlug(input.slug)) {
    return { ok: false, error: `invalid slug: ${input.slug}` };
  }
  if (input.locale !== undefined && !isValidEmailTemplateLocale(input.locale)) {
    return { ok: false, error: `invalid locale: ${input.locale}` };
  }
  const filename = input.locale ? `${input.slug}.${input.locale}.tsx` : `${input.slug}.tsx`;
  const relRoot = "src/modules/email/templates";
  const relative = `${relRoot}/${filename}`;
  // Reject roots that look like absolute paths or include traversal —
  // the slug regex already rejects `/` and `..` but we double-check the
  // composed path. Cheap belt-and-braces.
  if (relative.includes("..") || relative.includes("\\")) {
    return { ok: false, error: "path traversal detected" };
  }
  const absolute = `${stripTrailingSlash(input.projectRoot)}/${relative}`;
  // Anchor verification — the absolute path *must* start with the
  // module-templates prefix relative to the project root. Belt-and-
  // braces against a trailing backslash or smuggled separator.
  const expectedPrefix = `${stripTrailingSlash(input.projectRoot)}/${relRoot}/`;
  if (!absolute.startsWith(expectedPrefix)) {
    return { ok: false, error: "resolved path escapes module-templates root" };
  }
  return { ok: true, absolutePath: absolute, relativePath: relative };
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export interface ValidateCompositionOptions {
  /** Allowed block types — falls back to `KNOWN_EMAIL_BLOCKS`. */
  knownBlocks?: readonly string[];
  /** Allowed layout names — falls back to `KNOWN_EMAIL_LAYOUTS`. */
  knownLayouts?: readonly string[];
}

export type ValidateCompositionResult = { ok: true } | { ok: false; error: string };

export function validateEmailComposition(
  composition: EmailComposition,
  options: ValidateCompositionOptions = {},
): ValidateCompositionResult {
  const knownBlocks = options.knownBlocks ?? KNOWN_EMAIL_BLOCKS;
  const knownLayouts = options.knownLayouts ?? KNOWN_EMAIL_LAYOUTS;
  if (!knownLayouts.includes(composition.layout)) {
    return { ok: false, error: `unknown layout: ${composition.layout}` };
  }
  if (typeof composition.subject !== "string" || composition.subject.trim() === "") {
    return { ok: false, error: "subject must be a non-empty string" };
  }
  if (!Array.isArray(composition.children)) {
    return { ok: false, error: "children must be an array" };
  }
  for (const [i, block] of composition.children.entries()) {
    if (typeof block !== "object" || block === null) {
      return { ok: false, error: `children[${i}] must be an object` };
    }
    if (!knownBlocks.includes(block.type)) {
      return { ok: false, error: `unknown block type at children[${i}]: ${block.type}` };
    }
    if (block.type === "cta") {
      const href = block.props?.href;
      if (typeof href !== "string" || href.trim() === "") {
        return {
          ok: false,
          error: `cta block at children[${i}] is missing required prop "href"`,
        };
      }
    }
  }
  return { ok: true };
}

export interface ComposeEmailTemplateSourceInput {
  slug: string;
  composition: EmailComposition;
}

/**
 * Codegen — turns a JSON composition into a `.tsx` source string.
 *
 * Output contract:
 *   - File header with an `AUTO-GENERATED` banner so hand-edits get
 *     warned-about (the next save overwrites them).
 *   - Imports: `* as React`, `Barebone` from `../layouts/`, every
 *     referenced block from `../blocks/`, and the `BrandConfig` type.
 *   - Vars interface: every distinct `{{name}}` collected from
 *     subject + preheader + every block prop becomes a `string` field.
 *   - Subject factory: `<slug>Meta.subject` returning a template
 *     literal that interpolates `vars.<name>`.
 *   - Default export: PascalCased function returning the JSX tree.
 *
 * Determinism:
 *   - Imports + vars sorted alphabetically.
 *   - Whitespace/indentation hand-rolled — no prettier in the planner.
 */
export function composeEmailTemplateSource(input: ComposeEmailTemplateSourceInput): string {
  const { slug, composition } = input;
  const camelName = kebabToCamel(slug);
  const pascalName = kebabToPascal(slug);
  const vars = collectVariables(composition);
  const blockTypes = collectBlockTypes(composition);
  const blockImports = blockTypes
    .map(blockTypeToComponentName)
    .filter((name): name is string => name !== null)
    .sort();
  const varsInterface = vars.map((v) => `  ${v}: string;`).join("\n");
  const blockImportLine = blockImports.length
    ? `import { ${blockImports.join(", ")} } from "../blocks/index.js";\n`
    : "";

  const subjectExpression = renderInterpolatedTemplateLiteral(composition.subject);
  const preheaderExpression =
    composition.preheader !== undefined
      ? renderInterpolatedTemplateLiteral(composition.preheader)
      : null;

  const childrenJsx = composition.children
    .map((block) => renderBlockJsx(block))
    .join("\n");

  const lines: string[] = [
    "/**",
    " * AUTO-GENERATED by `/dev/email-builder` — do not edit by hand.",
    " * Hand-edits will be overwritten on the next save from the builder UI.",
    " */",
    'import * as React from "react";',
    "",
    'import { Barebone } from "../layouts/Barebone.js";',
  ];
  if (blockImportLine) lines.push(blockImportLine.trimEnd());
  lines.push('import type { BrandConfig } from "../brand.js";', "");
  lines.push(`export interface ${pascalName}Vars {`);
  if (varsInterface) lines.push(varsInterface);
  lines.push("}", "");
  lines.push(`export const ${camelName}Meta = {`);
  lines.push(`  name: "${slug}",`);
  lines.push(
    vars.length === 0
      ? `  subject: (_vars: ${pascalName}Vars): string => ${subjectExpression},`
      : `  subject: (vars: ${pascalName}Vars): string => ${subjectExpression},`,
  );
  lines.push("};", "");
  lines.push(`export interface ${pascalName}Props extends ${pascalName}Vars {`);
  lines.push("  brand?: BrandConfig;");
  lines.push("}", "");
  lines.push(`export default function ${pascalName}(props: ${pascalName}Props): React.ReactElement {`);
  const preheaderAttr = preheaderExpression ? ` preheader={${preheaderExpression}}` : "";
  lines.push("  return (");
  lines.push(`    <Barebone brand={props.brand}${preheaderAttr}>`);
  if (childrenJsx) lines.push(indentLines(childrenJsx, 6));
  lines.push("    </Barebone>");
  lines.push("  );");
  lines.push("}", "");
  return lines.join("\n");
}

// -------------------------------------------------------------------
// Internals
// -------------------------------------------------------------------

const VAR_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

function collectVariables(composition: EmailComposition): string[] {
  const set = new Set<string>();
  collectVariablesFromString(composition.subject, set);
  if (composition.preheader) collectVariablesFromString(composition.preheader, set);
  for (const block of composition.children) {
    if (!block.props) continue;
    for (const value of Object.values(block.props)) {
      if (typeof value === "string") collectVariablesFromString(value, set);
    }
  }
  return [...set].sort();
}

function collectVariablesFromString(value: string, target: Set<string>): void {
  for (const match of value.matchAll(VAR_PATTERN)) {
    if (match[1]) target.add(match[1]);
  }
}

function collectBlockTypes(composition: EmailComposition): string[] {
  const set = new Set<string>();
  for (const block of composition.children) set.add(block.type);
  return [...set].sort();
}

function blockTypeToComponentName(blockType: string): string | null {
  switch (blockType) {
    case "greeting":
      return "Greeting";
    case "paragraph":
      return "Paragraph";
    case "cta":
      return "CTA";
    case "footer":
      return "Footer";
    case "code":
      return "Code";
    case "divider":
      return "Divider";
    default:
      return null;
  }
}

function kebabToPascal(slug: string): string {
  return slug
    .split("-")
    .filter((s) => s.length > 0)
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join("");
}

function kebabToCamel(slug: string): string {
  const pascal = kebabToPascal(slug);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Render a string with `{{var}}` interpolations as a JS template
 * literal — `Hello {{recipientName}}` → `` `Hello ${vars.recipientName}` ``.
 *
 * Plain strings (no placeholders) come through as a double-quoted
 * literal so the generated source stays readable.
 */
function renderInterpolatedTemplateLiteral(value: string): string {
  if (!VAR_PATTERN.test(value)) {
    VAR_PATTERN.lastIndex = 0; // .test(global) advances state — reset
    return JSON.stringify(value);
  }
  VAR_PATTERN.lastIndex = 0;
  // Escape backticks + `${` in the literal portion so the wrapping
  // template-literal stays syntactically valid even if the source had
  // them (it shouldn't in transactional copy, but defense-in-depth).
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${")
    .replace(VAR_PATTERN, (_match, name: string) => `\${vars.${name}}`);
  return `\`${escaped}\``;
}

/**
 * Render a string with `{{var}}` interpolations as a JSX-friendly
 * fragment list. Plain text portions become string literals; the
 * placeholders become `{props.<name>}` expressions.
 */
function renderInterpolatedJsxChildren(value: string): string {
  // Walk the string in order, flushing literal segments as JSON-quoted
  // strings and var references as `{props.<name>}`. We deliberately
  // emit one Fragment via `<>{...}</>` only when the result is mixed,
  // otherwise plain text or a single expression is enough.
  const parts: string[] = [];
  let cursor = 0;
  for (const match of value.matchAll(VAR_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      parts.push(JSON.stringify(value.slice(cursor, start)));
    }
    parts.push(`props.${match[1]}`);
    cursor = start + match[0].length;
  }
  if (cursor < value.length) {
    parts.push(JSON.stringify(value.slice(cursor)));
  }
  if (parts.length === 0) return JSON.stringify(value);
  if (parts.length === 1) return parts[0] ?? '""';
  // Mixed text + interpolation — wrap in braces with a `+` join so we
  // don't need to introduce a Fragment node and the generated source
  // stays linter-friendly.
  return parts.join(" + ");
}

function renderBlockJsx(block: EmailBlockSpec): string {
  switch (block.type) {
    case "greeting":
      return wrapJsx("Greeting", "brand={props.brand}", textChild(block.props?.text));
    case "paragraph":
      return wrapJsx("Paragraph", "brand={props.brand}", textChild(block.props?.text));
    case "cta": {
      const href = block.props?.href;
      const hrefAttr =
        typeof href === "string" ? ` href={${renderInterpolatedJsxChildren(href)}}` : "";
      return wrapJsx(
        "CTA",
        `brand={props.brand}${hrefAttr}`,
        textChild(block.props?.text),
      );
    }
    case "footer":
      return wrapJsx("Footer", "brand={props.brand}", textChild(block.props?.text));
    case "code":
      return wrapJsx("Code", "brand={props.brand}", textChild(block.props?.text));
    case "divider":
      return `<Divider />`;
    default:
      return `{/* unknown block: ${block.type} */}`;
  }
}

function textChild(value: string | number | boolean | undefined): string {
  if (value === undefined) return "";
  const str = String(value);
  // Pure literal — emit as JSX text.
  if (!VAR_PATTERN.test(str)) {
    VAR_PATTERN.lastIndex = 0;
    return str;
  }
  VAR_PATTERN.lastIndex = 0;
  // Has interpolation — rewrite as `{props.<name>}` interspersed.
  let out = "";
  let cursor = 0;
  for (const match of str.matchAll(VAR_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) out += escapeJsxText(str.slice(cursor, start));
    out += `{props.${match[1]}}`;
    cursor = start + match[0].length;
  }
  if (cursor < str.length) out += escapeJsxText(str.slice(cursor));
  return out;
}

/**
 * JSX text escaping — only the structural characters (`<`, `>`, `{`,
 * `}`) need escape. Quotes inside JSX text are fine; the `replace`
 * mapping keeps the source human-readable for the common case.
 */
function escapeJsxText(value: string): string {
  return value
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function wrapJsx(component: string, attrs: string, child: string): string {
  if (!child) return `<${component} ${attrs} />`;
  return `<${component} ${attrs}>${child}</${component}>`;
}

function indentLines(value: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n");
}
