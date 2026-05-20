/**
 * Email-Builder planners — Issue #9.
 *
 * Pure functions powering the `/hub/email-builder` UI:
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
  "new-device",
] as const;

export const KNOWN_EMAIL_LAYOUTS = ["Barebone"] as const;

/** Relative prefix from `src/modules/email/templates/*.tsx` to `src/core/email/`. */
export const MODULE_TEMPLATE_CORE_IMPORT_PREFIX = "../../../core/email";

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
  const success: { ok: true } = { ok: true };
  return success;
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
    ? `import { ${blockImports.join(", ")} } from "${MODULE_TEMPLATE_CORE_IMPORT_PREFIX}/blocks/index.js";\n`
    : "";

  const subjectExpression = renderInterpolatedTemplateLiteral(composition.subject, "vars");
  const preheaderExpression =
    composition.preheader !== undefined
      ? renderInterpolatedTemplateLiteral(composition.preheader, "props")
      : null;

  const childrenJsx = composition.children.map((block) => renderBlockJsx(block)).join("\n");

  // Generated files land in src/modules/email/templates/, so core imports
  // must use paths relative to that location.
  const lines: string[] = [
    "/**",
    " * AUTO-GENERATED by `/hub/email-builder` — do not edit by hand.",
    " * Hand-edits will be overwritten on the next save from the builder UI.",
    " */",
    'import * as React from "react";',
    "",
    `import { Barebone } from "${MODULE_TEMPLATE_CORE_IMPORT_PREFIX}/layouts/Barebone.js";`,
  ];
  if (blockImportLine) lines.push(blockImportLine.trimEnd());
  lines.push(
    `import type { BrandConfig } from "${MODULE_TEMPLATE_CORE_IMPORT_PREFIX}/brand.js";`,
    "",
  );
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
  lines.push(
    `export default function ${pascalName}(props: ${pascalName}Props): React.ReactElement {`,
  );
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
function renderInterpolatedTemplateLiteral(value: string, ref: "vars" | "props"): string {
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
    .replace(VAR_PATTERN, (_match, name: string) => `\${${ref}.${name}}`);
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
      return wrapJsx("CTA", `brand={props.brand}${hrefAttr}`, textChild(block.props?.text));
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

// -------------------------------------------------------------------
// decomposeTemplateSource — Issue #49
// -------------------------------------------------------------------

/**
 * Result of `decomposeTemplateSource`.
 *
 * - `decomposable: true` — the source matches the composer's grammar
 *   and round-trips through `composeEmailTemplateSource()`.
 * - `decomposable: false` — the source contains hand-written JSX
 *   (custom components, conditionals, computed expressions outside
 *   the grammar). The Email-Builder UI falls back to a read-only
 *   source view in that case.
 */
export type DecomposeTemplateSourceResult =
  | { decomposable: true; composition: EmailComposition }
  | { decomposable: false; reason: string };

/**
 * Inverse of `composeEmailTemplateSource`. Parses a `.tsx` source
 * string back into the JSON composition the `/hub/email-builder` UI
 * consumes.
 *
 * Strategy: regex-based extraction. The composer's grammar is fixed
 * and small (one layout, six block types, three text-shaped fields),
 * so we don't need a full TypeScript parser. We:
 *
 *   1. Extract the subject string from `<name>Meta.subject(...)`.
 *   2. Find the `<Barebone ...>` root and read its `preheader` attr.
 *   3. Walk the children — each must be one of the known block tags
 *      with the exact prop shape the composer emits.
 *
 * Anything that doesn't fit (unknown component, ternary children,
 * nested JSX in a text slot) returns `decomposable: false`. The UI
 * still lets the operator open the file for inspection but disables
 * the structural editor for it.
 */
export function decomposeTemplateSource(source: string): DecomposeTemplateSourceResult {
  if (typeof source !== "string" || source.length === 0) {
    return { decomposable: false, reason: "source must be a non-empty string" };
  }

  // 1. Subject — locate `<camelName>Meta` and read the subject factory's
  // return expression. We accept either string-literal or template-
  // literal (with `${vars.X}` or `${props.X}` references — the composer
  // historically emitted both forms).
  const subjectResult = extractSubject(source);
  if (!subjectResult.ok) return { decomposable: false, reason: subjectResult.reason };

  // 2. Barebone root — the default-export JSX must wrap a Barebone
  // element. We pull out the contents between the opening tag and the
  // matching `</Barebone>`.
  const bareboneResult = extractBareboneRoot(source);
  if (!bareboneResult.ok) return { decomposable: false, reason: bareboneResult.reason };

  // 3. Preheader — optional, parsed from the Barebone opening tag.
  const preheaderResult = extractPreheader(bareboneResult.openingTag);
  if (!preheaderResult.ok) return { decomposable: false, reason: preheaderResult.reason };

  // 4. Children — walk the tags inside the Barebone wrapper.
  const childrenResult = parseBareboneChildren(bareboneResult.children);
  if (!childrenResult.ok) return { decomposable: false, reason: childrenResult.reason };

  const composition: EmailComposition = {
    layout: "Barebone",
    subject: subjectResult.value,
    children: childrenResult.value,
  };
  if (preheaderResult.value !== undefined) composition.preheader = preheaderResult.value;
  return { decomposable: true, composition };
}

interface OkResult<T> {
  ok: true;
  value: T;
}
interface ErrResult {
  ok: false;
  reason: string;
}
type Result<T> = OkResult<T> | ErrResult;

/**
 * Resolve a JSX-emitted text expression back to a `{{var}}` template.
 * Handles four shapes the composer emits or a hand-written core
 * template uses:
 *
 *   1. Plain text — preserved as-is (with `&apos;` etc. decoded).
 *   2. `{props.<name>}` / `{vars.<name>}` — `{{<name>}}` token.
 *   3. Concatenations — `"hi " + props.x + " there"`.
 *   4. Mixed JSX text + braced expressions.
 *
 * The decoder is intentionally conservative: anything outside this
 * grammar returns an error so the caller can fall back to the
 * read-only source view.
 */
function decodeTextExpression(raw: string): Result<string> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: "" };

  // "+"-joined concatenation — split on top-level `+` and decode each.
  const parts = splitTopLevelConcat(trimmed);
  if (parts === null) {
    return { ok: false, reason: "unbalanced expression in text" };
  }
  let out = "";
  for (const part of parts) {
    const piece = part.trim();
    if (piece.length === 0) continue;
    const decoded = decodeAtomicTextExpression(piece);
    if (!decoded.ok) return decoded;
    out += decoded.value;
  }
  return { ok: true, value: out };
}

function decodeAtomicTextExpression(piece: string): Result<string> {
  // String literal (single or double-quoted).
  const stringLit = parseStringLiteral(piece);
  if (stringLit !== null) return { ok: true, value: stringLit };
  // Template literal — `\`...${vars.x}...\``.
  if (piece.startsWith("`") && piece.endsWith("`") && piece.length >= 2) {
    return decodeTemplateLiteral(piece);
  }
  // Bare reference — `props.x` / `vars.x`.
  const ref = piece.match(/^(?:props|vars)\.([a-zA-Z_][a-zA-Z0-9_]*)$/);
  if (ref) return { ok: true, value: `{{${ref[1]}}}` };
  return { ok: false, reason: `unsupported text expression: ${piece.slice(0, 60)}` };
}

function parseStringLiteral(piece: string): string | null {
  if (
    (piece.startsWith('"') && piece.endsWith('"')) ||
    (piece.startsWith("'") && piece.endsWith("'"))
  ) {
    if (piece.length < 2) return null;
    try {
      // JSON.parse handles the double-quoted case directly. For
      // single-quotes we re-quote first; literals in the composer
      // output never embed escaped quotes so a swap is safe.
      if (piece.startsWith("'")) {
        const swapped = `"${piece.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`;
        return JSON.parse(swapped) as string;
      }
      return JSON.parse(piece) as string;
    } catch {
      return null;
    }
  }
  return null;
}

function decodeTemplateLiteral(literal: string): Result<string> {
  // Strip the wrapping backticks.
  const body = literal.slice(1, -1);
  let out = "";
  let i = 0;
  while (i < body.length) {
    if (body[i] === "\\" && i + 1 < body.length) {
      // Unescape composer-emitted sequences: \\, \`, \${.
      const next = body[i + 1];
      if (next === "\\") out += "\\";
      else if (next === "`") out += "`";
      else if (next === "$") out += "$";
      else out += next ?? "";
      i += 2;
      continue;
    }
    if (body[i] === "$" && body[i + 1] === "{") {
      const close = body.indexOf("}", i + 2);
      if (close === -1) return { ok: false, reason: "unterminated ${} in template literal" };
      const expr = body.slice(i + 2, close).trim();
      const ref = expr.match(/^(?:props|vars)\.([a-zA-Z_][a-zA-Z0-9_]*)$/);
      if (!ref) {
        return { ok: false, reason: `unsupported template-literal expression: ${expr}` };
      }
      out += `{{${ref[1]}}}`;
      i = close + 1;
      continue;
    }
    out += body[i];
    i++;
  }
  return { ok: true, value: out };
}

/**
 * Split a JS expression on top-level `+` operators (concatenation).
 * Returns null when the expression is unbalanced. Skips `+` inside
 * strings, template literals, and nested braces/parens.
 */
function splitTopLevelConcat(expr: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let inString: '"' | "'" | "`" | null = null;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (inString) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch as '"' | "'" | "`";
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "+" && depth === 0) {
      parts.push(expr.slice(start, i));
      start = i + 1;
    }
  }
  if (depth !== 0 || inString !== null) return null;
  parts.push(expr.slice(start));
  return parts;
}

/**
 * Decode the JSX-text portion of a composer-emitted block child. The
 * composer escapes `<`, `>`, `{`, `}` to HTML entities; everything
 * else passes through. We also decode common entities that hand-rolled
 * core templates contain (`&apos;`, `&amp;`, `&quot;`, `&nbsp;`,
 * `&#NNN;`) so source files written before the builder existed
 * round-trip after one decompose-recompose cycle.
 */
function decodeJsxText(raw: string): string {
  // Replace common HTML entities the composer would have written or a
  // hand-rolled template might use.
  let out = raw
    .replace(/&#123;/g, "{")
    .replace(/&#125;/g, "}")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
  // Numeric entities — `&#NNN;`.
  out = out.replace(/&#(\d+);/g, (_match, code: string) => {
    const n = Number.parseInt(code, 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : _match;
  });
  return out;
}

/**
 * Parse the JSX *children* of a block element (everything between
 * `<Greeting ...>` and `</Greeting>`). The grammar mirrors what the
 * composer emits via `textChild()`:
 *
 *   - Plain text segments → escaped JSX text.
 *   - Braced `{props.<name>}` → `{{<name>}}` placeholders.
 *   - Whitespace between segments → preserved.
 *
 * Anything else (nested JSX, conditionals, function calls) trips
 * the decomposer.
 */
function decodeBlockTextChildren(children: string): Result<string> {
  let out = "";
  let i = 0;
  while (i < children.length) {
    if (children[i] === "{") {
      // Walk to the matching `}` accounting for nested braces inside
      // the expression (object literals, ternaries — though we reject
      // those at the next layer).
      const close = findMatchingBrace(children, i);
      if (close === -1) return { ok: false, reason: "unterminated {} in block children" };
      const expr = children.slice(i + 1, close).trim();
      // JSX text-string-with-spaces idioms — `{" "}` and `{' '}` —
      // come through here and just feed back into the literal.
      const stringLit = parseStringLiteral(expr);
      if (stringLit !== null) {
        out += stringLit;
      } else {
        const ref = expr.match(/^(?:props|vars)\.([a-zA-Z_][a-zA-Z0-9_]*)$/);
        if (!ref) {
          return {
            ok: false,
            reason: `unsupported expression in block children: ${expr.slice(0, 60)}`,
          };
        }
        out += `{{${ref[1]}}}`;
      }
      i = close + 1;
      continue;
    }
    if (children[i] === "<") {
      return { ok: false, reason: "unexpected nested JSX inside block children" };
    }
    // Find the next `{` or `<` boundary; pass through plain text.
    const next = findNextDelimiter(children, i);
    out += decodeJsxText(children.slice(i, next));
    i = next;
  }
  // Collapse leading/trailing whitespace — JSX would have done the
  // same when the original tree rendered.
  return { ok: true, value: out.trim() };
}

function findNextDelimiter(value: string, from: number): number {
  for (let i = from; i < value.length; i++) {
    if (value[i] === "{" || value[i] === "<") return i;
  }
  return value.length;
}

function findMatchingBrace(value: string, openIndex: number): number {
  let depth = 0;
  let inString: '"' | "'" | "`" | null = null;
  for (let i = openIndex; i < value.length; i++) {
    const ch = value[i];
    if (inString) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch as '"' | "'" | "`";
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractSubject(source: string): Result<string> {
  // Find the *Meta export and the subject arrow inside it. Tolerant of
  // whitespace and the `_vars` / `vars` parameter names the composer
  // emits for var-less and var-using compositions respectively.
  const metaMatch = source.match(
    /export\s+const\s+[a-zA-Z_][a-zA-Z0-9_]*Meta\s*=\s*\{([\s\S]*?)\};/,
  );
  if (!metaMatch) return { ok: false, reason: "missing *Meta export" };
  const metaBody = metaMatch[1] ?? "";
  // The arrow body is `subject: (vars: TVars): string => <expr>,` —
  // anchor on `subject:` and read until the next top-level comma.
  const subjectIdx = metaBody.indexOf("subject:");
  if (subjectIdx === -1) return { ok: false, reason: "missing subject factory" };
  const arrowIdx = metaBody.indexOf("=>", subjectIdx);
  if (arrowIdx === -1) return { ok: false, reason: "subject factory has no arrow" };
  const after = metaBody.slice(arrowIdx + 2);
  const exprEnd = findExpressionEnd(after);
  if (exprEnd === -1) return { ok: false, reason: "subject factory has no terminator" };
  const expr = after.slice(0, exprEnd).trim();
  return decodeTextExpression(expr);
}

function findExpressionEnd(value: string): number {
  // Walk to the next top-level comma, semicolon or end-of-string. Skip
  // commas nested inside parens / braces / strings / template literals.
  let depth = 0;
  let inString: '"' | "'" | "`" | null = null;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (inString) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch as '"' | "'" | "`";
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (depth === 0 && (ch === "," || ch === ";")) return i;
  }
  return value.length;
}

function extractBareboneRoot(
  source: string,
): { ok: true; openingTag: string; children: string } | ErrResult {
  // Match `<Barebone ...>` — could span multiple lines and include
  // brace-balanced JSX expression attributes. Then walk to the matching
  // `</Barebone>` skipping any nested instance defensively.
  const openIdx = source.indexOf("<Barebone");
  if (openIdx === -1) return { ok: false, reason: "missing <Barebone> root" };
  const tagEnd = findJsxTagEnd(source, openIdx);
  if (tagEnd === -1) return { ok: false, reason: "unterminated <Barebone> opening tag" };
  const openingTag = source.slice(openIdx, tagEnd + 1);
  // Self-closing tag — no children.
  if (openingTag.endsWith("/>")) {
    return { ok: true, openingTag, children: "" };
  }
  // Find matching close.
  const childrenStart = tagEnd + 1;
  let depth = 1;
  let cursor = childrenStart;
  const childRe = /<\s*\/?\s*Barebone\b/g;
  childRe.lastIndex = cursor;
  while (depth > 0) {
    const match = childRe.exec(source);
    if (!match) return { ok: false, reason: "missing </Barebone> close" };
    if (match[0].includes("/")) depth--;
    else depth++;
    cursor = match.index + match[0].length;
  }
  const closeIdx = source.lastIndexOf("</", cursor);
  return { ok: true, openingTag, children: source.slice(childrenStart, closeIdx) };
}

/**
 * Walk to the closing `>` of a JSX tag starting at `<`. Accounts for
 * brace-balanced expression attributes (`brand={props.brand}`) and
 * quoted attribute strings.
 */
function findJsxTagEnd(source: string, start: number): number {
  let depth = 0;
  let inString: '"' | "'" | null = null;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch as '"' | "'";
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return i;
  }
  return -1;
}

function extractPreheader(openingTag: string): Result<string | undefined> {
  // The opening tag looks like `<Barebone brand={props.brand} preheader={...}>`.
  // We seek the `preheader=` attribute and parse its expression.
  const idx = openingTag.search(/\bpreheader\s*=/);
  if (idx === -1) return { ok: true, value: undefined };
  const afterEq = openingTag.slice(idx).replace(/^[a-zA-Z]+\s*=\s*/, "");
  // Either a string literal (`"..."`) or a `{ expr }` JSX-attribute.
  if (afterEq.startsWith('"') || afterEq.startsWith("'")) {
    const literal = parseDelimitedString(afterEq);
    if (literal === null) return { ok: false, reason: "preheader literal unterminated" };
    return { ok: true, value: literal };
  }
  if (afterEq.startsWith("{")) {
    const close = findMatchingBrace(afterEq, 0);
    if (close === -1) return { ok: false, reason: "preheader expression unterminated" };
    const expr = afterEq.slice(1, close).trim();
    const decoded = decodeTextExpression(expr);
    if (!decoded.ok) return decoded;
    return { ok: true, value: decoded.value };
  }
  return { ok: false, reason: "preheader attribute has unsupported value" };
}

function parseDelimitedString(value: string): string | null {
  if (value.length < 2) return null;
  const quote = value[0];
  if (quote !== '"' && quote !== "'") return null;
  for (let i = 1; i < value.length; i++) {
    if (value[i] === "\\") {
      i++;
      continue;
    }
    if (value[i] === quote) {
      return parseStringLiteral(value.slice(0, i + 1));
    }
  }
  return null;
}

interface ParsedJsxElement {
  tag: string;
  attrs: string;
  children: string | null;
  selfClosed: boolean;
  end: number;
}

/**
 * Walk the children of `<Barebone>` and decode each top-level JSX
 * element into an `EmailBlockSpec`. Whitespace-only segments are
 * tolerated (the composer indents the tree); anything else (a stray
 * text node, a non-block tag, a brace expression) is fatal.
 */
function parseBareboneChildren(children: string): Result<EmailBlockSpec[]> {
  const out: EmailBlockSpec[] = [];
  let i = 0;
  while (i < children.length) {
    const ch = children[i];
    if (ch === undefined) break;
    // Skip whitespace.
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch !== "<") {
      return {
        ok: false,
        reason: `unexpected non-JSX content in Barebone children at position ${i}`,
      };
    }
    const parsed = parseJsxElement(children, i);
    if (!parsed.ok) return parsed;
    const block = jsxElementToBlock(parsed.value);
    if (!block.ok) return block;
    out.push(block.value);
    i = parsed.value.end;
  }
  return { ok: true, value: out };
}

function parseJsxElement(source: string, start: number): Result<ParsedJsxElement> {
  if (source[start] !== "<") {
    return { ok: false, reason: "expected `<` at element start" };
  }
  // Read the tag name.
  const nameMatch = source.slice(start + 1).match(/^([A-Za-z][A-Za-z0-9_]*)/);
  if (!nameMatch) return { ok: false, reason: "missing tag name" };
  const tag = nameMatch[1] ?? "";
  const attrsStart = start + 1 + (nameMatch[0]?.length ?? 0);
  const tagEnd = findJsxTagEnd(source, start);
  if (tagEnd === -1) return { ok: false, reason: "unterminated opening tag" };
  const inner = source.slice(attrsStart, tagEnd);
  const selfClosed = inner.trimEnd().endsWith("/");
  const attrs = selfClosed ? inner.trimEnd().slice(0, -1) : inner;
  if (selfClosed) {
    return { ok: true, value: { tag, attrs, children: null, selfClosed: true, end: tagEnd + 1 } };
  }
  // Find the matching close tag. We disallow nested same-named blocks
  // (the composer never emits them); a nested same tag means hand-
  // written content outside our grammar.
  const childrenStart = tagEnd + 1;
  const closeRe = new RegExp(`<\\s*/\\s*${tag}\\s*>`, "g");
  closeRe.lastIndex = childrenStart;
  // Reject nested same-tag elements.
  const openRe = new RegExp(`<\\s*${tag}\\b`, "g");
  openRe.lastIndex = childrenStart;
  const close = closeRe.exec(source);
  if (!close) return { ok: false, reason: `missing </${tag}> close` };
  const nestedOpen = openRe.exec(source);
  if (nestedOpen && nestedOpen.index < close.index) {
    return { ok: false, reason: `nested <${tag}> not allowed in composer grammar` };
  }
  const childrenStr = source.slice(childrenStart, close.index);
  return {
    ok: true,
    value: {
      tag,
      attrs,
      children: childrenStr,
      selfClosed: false,
      end: close.index + close[0].length,
    },
  };
}

function jsxElementToBlock(el: ParsedJsxElement): Result<EmailBlockSpec> {
  const blockType = componentNameToBlockType(el.tag);
  if (blockType === null) {
    return { ok: false, reason: `unknown JSX tag <${el.tag}>` };
  }
  // Verify the only attribute is `brand={props.brand}` plus, for CTA,
  // `href={...}`. Anything else (custom styles, computed expressions)
  // means the source was hand-rolled outside the grammar.
  const attrCheck = verifyKnownAttrs(el.tag, el.attrs);
  if (!attrCheck.ok) return attrCheck;

  if (blockType === "divider") {
    return { ok: true, value: { type: "divider", props: {} } };
  }
  if (el.selfClosed) {
    return { ok: false, reason: `block <${el.tag}/> self-closed but expects text children` };
  }
  const text = decodeBlockTextChildren(el.children ?? "");
  if (!text.ok) return text;
  if (blockType === "cta") {
    const href = attrCheck.cta?.href;
    if (href === undefined) {
      return { ok: false, reason: "CTA block missing href attr" };
    }
    return { ok: true, value: { type: "cta", props: { href, text: text.value } } };
  }
  return { ok: true, value: { type: blockType, props: { text: text.value } } };
}

function componentNameToBlockType(name: string): EmailBlockType | null {
  switch (name) {
    case "Greeting":
      return "greeting";
    case "Paragraph":
      return "paragraph";
    case "CTA":
      return "cta";
    case "Footer":
      return "footer";
    case "Code":
      return "code";
    case "Divider":
      return "divider";
    default:
      return null;
  }
}

interface AttrCheckResult {
  ok: true;
  cta?: { href: string };
}

/**
 * Walk the attribute string of a block element and verify it matches
 * what the composer emits: every block carries `brand={props.brand}`,
 * CTAs additionally carry `href={...}`. Any other attribute name or
 * a non-matching expression for `brand` means the source is outside
 * the grammar.
 */
function verifyKnownAttrs(tag: string, attrs: string): AttrCheckResult | ErrResult {
  const tokens = tokenizeJsxAttrs(attrs);
  if (tokens === null) return { ok: false, reason: `unparseable attrs on <${tag}>` };
  let brandSeen = false;
  let href: string | undefined;
  for (const { name, value } of tokens) {
    if (name === "brand") {
      // Must be `{props.brand}` or `{vars.brand}` — the composer
      // emits the former; we tolerate the latter for safety.
      const ref = value.trim().match(/^\{(?:props|vars)\.brand\}$/);
      if (!ref) return { ok: false, reason: `<${tag}> brand attr is not props.brand` };
      brandSeen = true;
      continue;
    }
    if (name === "href" && tag === "CTA") {
      // Either `{<expression>}` or `"literal"`. Decode through the
      // text-expression decoder so `{{var}}` placeholders survive.
      const trimmed = value.trim();
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        const inner = trimmed.slice(1, -1).trim();
        const decoded = decodeTextExpression(inner);
        if (!decoded.ok) return { ok: false, reason: `<${tag}> href: ${decoded.reason}` };
        href = decoded.value;
        continue;
      }
      if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
        const lit = parseStringLiteral(trimmed);
        if (lit === null) return { ok: false, reason: `<${tag}> href literal unparseable` };
        href = lit;
        continue;
      }
      return { ok: false, reason: `<${tag}> href has unsupported value` };
    }
    return { ok: false, reason: `<${tag}> has unknown attr "${name}"` };
  }
  if (tag !== "Divider" && !brandSeen) {
    return { ok: false, reason: `<${tag}> missing brand={props.brand}` };
  }
  if (tag === "CTA" && href === undefined) {
    return { ok: false, reason: "<CTA> missing href attr" };
  }
  return tag === "CTA" ? { ok: true, cta: { href: href ?? "" } } : { ok: true };
}

interface JsxAttr {
  name: string;
  value: string;
}

function tokenizeJsxAttrs(attrs: string): JsxAttr[] | null {
  const out: JsxAttr[] = [];
  let i = 0;
  while (i < attrs.length) {
    const ch = attrs[i];
    if (ch === undefined) break;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    // Read attribute name.
    const nameMatch = attrs.slice(i).match(/^([A-Za-z_][A-Za-z0-9_-]*)/);
    if (!nameMatch) return null;
    const name = nameMatch[1] ?? "";
    i += nameMatch[0]?.length ?? 0;
    // Optional `=` + value. Boolean attrs (no `=`) aren't part of the
    // composer grammar, but we tolerate them to fail at the next layer.
    if (attrs[i] !== "=") {
      out.push({ name, value: "true" });
      continue;
    }
    i++;
    const next = attrs[i];
    if (next === '"' || next === "'") {
      const close = findClosingQuote(attrs, i);
      if (close === -1) return null;
      out.push({ name, value: attrs.slice(i, close + 1) });
      i = close + 1;
      continue;
    }
    if (next === "{") {
      const close = findMatchingBrace(attrs, i);
      if (close === -1) return null;
      out.push({ name, value: attrs.slice(i, close + 1) });
      i = close + 1;
      continue;
    }
    return null;
  }
  return out;
}

function findClosingQuote(value: string, start: number): number {
  const quote = value[start];
  if (quote !== '"' && quote !== "'") return -1;
  for (let i = start + 1; i < value.length; i++) {
    if (value[i] === "\\") {
      i++;
      continue;
    }
    if (value[i] === quote) return i;
  }
  return -1;
}
