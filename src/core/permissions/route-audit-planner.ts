import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Pure planner for the route-gating audit (Issue #47).
 *
 * Given a TypeScript controller / module source string, walk every
 * `@Get/@Post/@Put/@Patch/@Delete/@All` decorator and classify it as:
 *
 *   - `gated`             — handler carries `@Can(action, subject)`
 *   - `public-by-design`  — handler carries `@Public("<reason>")` OR
 *                           the resolved full path matches one of the
 *                           jwt-middleware / tenant-guard public
 *                           prefixes / exact paths
 *   - `ungated-bug`       — neither
 *
 * The planner is regex-driven (no TypeScript compiler) on purpose:
 *
 *   - The CI gate runs on every PR; spinning up `ts.createSourceFile`
 *     for ~20 controller files is overkill.
 *   - The decorator surface is intentionally tight (`@Get`, `@Post`,
 *     `@Can`, `@Public`); regex parsing is honest enough to keep the
 *     planner deterministic and easy to debug.
 *   - It runs against the live tree, so it must not require Nest's
 *     runtime (no Reflect-metadata, no decorator evaluation).
 *
 * The runner half (`auditControllerRoutes`) walks the `src/` tree
 * and applies the planner to every `.controller.ts` / `.module.ts`
 * file. Both layers are pure-function-shaped — no I/O sneaks past
 * the runner.
 */

/** HTTP-method decorators we care about. `All` covers the
 * Better-Auth catch-all. */
const HTTP_METHOD_DECORATORS = new Set(["Get", "Post", "Put", "Patch", "Delete", "All"]);

/**
 * Default public-allowlist. Mirrors `jwt-middleware.ts`'s `PUBLIC_PREFIXES`
 * + `PUBLIC_EXACT` plus the `/admin/` and `/dev/` prefixes that the dev-
 * hub treats as `dev-only` (404 outside `NODE_ENV=development`).
 *
 * Keep this in sync with the runtime middleware allowlist; the audit
 * planner's job is to surface the consent decision, not to invent it.
 */
export const DEFAULT_PUBLIC_PREFIXES: readonly string[] = [
  "/health/",
  "/api/auth/",
  "/docs/",
  "/dev/",
  "/admin/",
  "/errors/",
  "/api/openapi",
];

export const DEFAULT_PUBLIC_EXACT: readonly string[] = ["/", "/errors", "/api/openapi"];

export type RouteClassification = "gated" | "public-by-design" | "ungated-bug";

export interface RouteCanDecorator {
  action: string;
  subject: string;
}

export interface RoutePublicDecorator {
  reason: string;
}

export interface RouteAuditFinding {
  /** Project-relative file path (forward slashes). */
  file: string;
  /** 1-based source line number of the HTTP-method decorator. */
  line: number;
  /** Class name carrying the route — e.g. `ApiKeyController`. */
  controllerClass: string;
  /** Method name on the class — e.g. `list`. */
  handler: string;
  /** HTTP verb (uppercase). */
  method: string;
  /** Resolved path including the controller's base prefix. */
  path: string;
  classification: RouteClassification;
  decorators: {
    can?: RouteCanDecorator;
    public?: RoutePublicDecorator;
    /** Allowlist prefix that matched, if any. */
    allowlistMatch?: string;
  };
}

export interface ParseControllerSourceInput {
  /** File label (used in findings). May be project-relative or absolute. */
  file: string;
  source: string;
  /**
   * Public path-prefix allowlist. Defaults to `DEFAULT_PUBLIC_PREFIXES`.
   * Tests can override (e.g. pass `[]` to disable allowlisting and force
   * every undecorated route to surface as `ungated-bug`).
   */
  publicPrefixes?: readonly string[];
  publicExact?: readonly string[];
}

/**
 * Parse a single controller / module source file and return one
 * `RouteAuditFinding` per HTTP-method decorator.
 */
export function parseControllerSource(input: ParseControllerSourceInput): RouteAuditFinding[] {
  const publicPrefixes = input.publicPrefixes ?? DEFAULT_PUBLIC_PREFIXES;
  const publicExact = new Set(input.publicExact ?? DEFAULT_PUBLIC_EXACT);
  const findings: RouteAuditFinding[] = [];

  // 1) Find every controller class in the file. Each carries a base path.
  //    Match `@Controller(...)` followed by an optional `export` and `class <Name>`.
  const controllerPattern =
    /@Controller\s*\(([^)]*)\)[\s\S]*?(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g;
  const controllers: Array<{
    name: string;
    basePath: string;
    /** Index of the `class <Name>` token in `source`. */
    classStart: number;
    /** Index of the matching closing `}` for the class body. */
    classEnd: number;
  }> = [];

  let m: RegExpExecArray | null;
  while ((m = controllerPattern.exec(input.source)) !== null) {
    const argsRaw = m[1] ?? "";
    const className = m[2] ?? "";
    const basePath = extractStringArg(argsRaw);
    // Find the `{` that opens the class body, then walk to the matching `}`.
    const braceOpen = input.source.indexOf("{", m.index + m[0].length);
    if (braceOpen < 0) continue;
    const braceClose = matchClosingBrace(input.source, braceOpen);
    if (braceClose < 0) continue;
    controllers.push({
      name: className,
      basePath,
      classStart: braceOpen,
      classEnd: braceClose,
    });
  }

  // 2) For each controller class, walk every HTTP-method decorator inside
  //    the class body, collect surrounding decorators, and emit a finding.
  for (const ctrl of controllers) {
    const body = input.source.slice(ctrl.classStart, ctrl.classEnd);
    const bodyOffset = ctrl.classStart;

    // Walk decorator-stacked method definitions. A "method block" starts
    // at the first decorator on a method (or at the method name itself
    // if no decorators) and ends at the method's opening `{`.
    //
    // Strategy: find every `@<HttpMethod>` token in the body, then for
    // each parse the decorator's full argument list (with paren
    // balancing), collect every decorator stacked above + below until
    // the handler name, and emit a single finding.
    const httpDecoratorRegex = /@(Get|Post|Put|Patch|Delete|All)\b/g;
    let dm: RegExpExecArray | null;
    while ((dm = httpDecoratorRegex.exec(body)) !== null) {
      const decName = dm[1] ?? "";
      if (!HTTP_METHOD_DECORATORS.has(decName)) continue;

      // Parse the decorator's argument list (balanced parens). The token
      // may be `@Get` (no parens) or `@Get(...)` — both are legal in
      // NestJS, even though our codebase always uses parens.
      const afterToken = dm.index + dm[0].length;
      let argsRaw = "";
      let endOfDecorator = afterToken;
      // Skip whitespace between identifier and `(`.
      let j = afterToken;
      while (j < body.length && (body[j] === " " || body[j] === "\t")) j++;
      if (body[j] === "(") {
        const closeParen = matchClosingParen(body, j);
        if (closeParen < 0) continue;
        argsRaw = body.slice(j + 1, closeParen);
        endOfDecorator = closeParen + 1;
      }

      const decAbsoluteIndex = bodyOffset + dm.index;
      const line = lineNumberFromIndex(input.source, decAbsoluteIndex);

      // Walk forward from the decorator to the method-name token. Along
      // the way, collect every `@Decorator(...)` that sits between the
      // http decorator and the handler — these are the "after" decorators.
      const forwardWalk = walkForwardCollectDecorators(body, endOfDecorator);
      const handlerName = forwardWalk.handlerName;
      if (!handlerName) continue;

      // Collect all decorators stacked above the http decorator (backward
      // walk through `@X(...)` blocks on consecutive lines).
      const stackedDecorators = collectStackedDecorators(body, dm.index);

      // Look at every decorator on this method (above + below the http
      // method). Either side is a valid place for `@Can` / `@Public`.
      const allDecorators = [...stackedDecorators, ...forwardWalk.decorators];
      let canMeta: RouteCanDecorator | undefined;
      let publicMeta: RoutePublicDecorator | undefined;
      for (const dec of allDecorators) {
        if (dec.name === "Can") {
          const args = parseDecoratorArgs(dec.args);
          if (args.length >= 2 && args[0] && args[1]) {
            canMeta = { action: args[0], subject: args[1] };
          }
        } else if (dec.name === "Public") {
          const args = parseDecoratorArgs(dec.args);
          // `@Public("")` is treated as missing consent — see the runtime
          // decorator's identical guard. The audit refuses to silence
          // findings with an empty reason string.
          if (args.length >= 1 && args[0] && args[0].trim().length > 0) {
            publicMeta = { reason: args[0] };
          }
        }
      }

      // Reset the regex pointer to skip past the decorator's full
      // argument list (otherwise nested `@Foo` inside the args could
      // re-trigger a match).
      httpDecoratorRegex.lastIndex = endOfDecorator;

      // Resolve the path: controller base + handler argument.
      const handlerPath = extractStringArg(argsRaw);
      const path = joinControllerPath(ctrl.basePath, handlerPath);

      // Allowlist match (only consulted when no @Can/@Public was set).
      const allowlistMatch = matchAllowlist(path, publicPrefixes, publicExact);

      let classification: RouteClassification;
      if (canMeta) {
        classification = "gated";
      } else if (publicMeta) {
        classification = "public-by-design";
      } else if (allowlistMatch) {
        classification = "public-by-design";
      } else {
        classification = "ungated-bug";
      }

      const decorators: RouteAuditFinding["decorators"] = {};
      if (canMeta) decorators.can = canMeta;
      if (publicMeta) decorators.public = publicMeta;
      if (allowlistMatch) decorators.allowlistMatch = allowlistMatch;

      findings.push({
        file: input.file,
        line,
        controllerClass: ctrl.name,
        handler: handlerName,
        method: decName.toUpperCase(),
        path,
        classification,
        decorators,
      });
    }
  }

  return findings;
}

export interface AuditControllerRoutesInput {
  /** Repo root the runner walks. */
  root: string;
  /** Override the default public-prefix allowlist. */
  publicPrefixes?: readonly string[];
  /** Override the default exact-path allowlist. */
  publicExact?: readonly string[];
  /**
   * Limit the walk to a subset of subpaths under `root` (relative).
   * Defaults to `["src"]` so test fixtures don't trip on test files
   * that reference decorators in fixture strings.
   */
  includeSubdirs?: readonly string[];
}

/**
 * Walk every `*.controller.ts` and `*.module.ts` under
 * `${root}/${subdir}/**` and run `parseControllerSource` on each.
 */
export function auditControllerRoutes(input: AuditControllerRoutesInput): RouteAuditFinding[] {
  const subdirs = input.includeSubdirs ?? ["src"];
  const findings: RouteAuditFinding[] = [];
  for (const subdir of subdirs) {
    const startDir = join(input.root, subdir);
    if (!safeIsDirectory(startDir)) continue;
    for (const file of walkSourceFiles(startDir)) {
      // Only `*.controller.ts` and `*.module.ts` carry routes. Anything
      // else (services, DTOs, planner files) cannot register an HTTP
      // surface — skipping them keeps the planner fast and noise-free.
      if (!file.endsWith(".controller.ts") && !file.endsWith(".module.ts")) continue;
      const source = readFileSync(file, "utf8");
      // Quick reject: no HTTP-method decorator → no work to do.
      if (!/@(Get|Post|Put|Patch|Delete|All)\s*\(/.test(source)) continue;
      const relativePath = relative(input.root, file).split(sep).join("/");
      const fileFindings = parseControllerSource({
        file: relativePath,
        source,
        ...(input.publicPrefixes !== undefined ? { publicPrefixes: input.publicPrefixes } : {}),
        ...(input.publicExact !== undefined ? { publicExact: input.publicExact } : {}),
      });
      findings.push(...fileFindings);
    }
  }
  return findings;
}

// ─── helpers ────────────────────────────────────────────────────────

function safeIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function* walkSourceFiles(dir: string): Generator<string> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, {
      withFileTypes: true,
      encoding: "utf8",
    }) as unknown as import("node:fs").Dirent[];
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = entry.name;
    const full = join(dir, name);
    if (entry.isDirectory()) {
      // Skip node_modules + dist out of paranoia even though we start
      // inside `src/`.
      if (name === "node_modules" || name === "dist") continue;
      yield* walkSourceFiles(full);
    } else if (entry.isFile() && name.endsWith(".ts")) {
      yield full;
    }
  }
}

/**
 * Pull the first string-literal argument out of a decorator argument
 * fragment. Tolerant of `'…'`, `"…"`, ``…`` quoting.
 */
function extractStringArg(args: string): string {
  const trimmed = args.trim();
  if (trimmed.length === 0) return "";
  const m = /^['"`]([^'"`]*)['"`]/.exec(trimmed);
  return m?.[1] ?? "";
}

/**
 * Parse decorator arguments as a list of string literals. For `@Can`
 * we want the action + subject; for `@Public` we want the reason.
 * Anything beyond a string literal (variables, expressions) is left
 * out — the audit planner intentionally treats those as "unknown" so
 * dynamic decorators don't accidentally pass the gate.
 */
function parseDecoratorArgs(args: string): string[] {
  const out: string[] = [];
  const re = /(['"`])((?:\\.|(?!\1).)*)\1/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(args)) !== null) {
    out.push(match[2] ?? "");
  }
  return out;
}

/**
 * Walk forward from the end of an HTTP-method decorator and collect
 * every other `@Foo(...)` decorator that sits between it and the
 * handler method name. Returns the handler name (or null) plus the
 * "after" decorator list.
 *
 * This complements `collectStackedDecorators` (which walks backward
 * over decorators above the http method). Together they capture every
 * decorator on the method, regardless of whether the author put
 * `@Can`/`@Public` before or after the `@Get`.
 */
function walkForwardCollectDecorators(
  body: string,
  fromIndex: number,
): { handlerName: string | null; decorators: Array<{ name: string; args: string }> } {
  const decorators: Array<{ name: string; args: string }> = [];
  let i = fromIndex;
  while (i < body.length) {
    const ch = body[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "@") {
      // Pull the decorator name + balanced argument list.
      let j = i + 1;
      while (j < body.length && /[A-Za-z0-9_$]/.test(body[j] ?? "")) j++;
      const name = body.slice(i + 1, j);
      // Optional whitespace before `(`.
      while (j < body.length && (body[j] === " " || body[j] === "\t")) j++;
      if (body[j] === "(") {
        const closeParen = matchClosingParen(body, j);
        if (closeParen < 0) return { handlerName: null, decorators };
        decorators.push({ name, args: body.slice(j + 1, closeParen) });
        i = closeParen + 1;
        continue;
      }
      // Argument-less decorator.
      decorators.push({ name, args: "" });
      i = j;
      continue;
    }
    if (ch === "/" && body[i + 1] === "/") {
      const eol = body.indexOf("\n", i);
      if (eol < 0) return { handlerName: null, decorators };
      i = eol + 1;
      continue;
    }
    if (ch === "/" && body[i + 1] === "*") {
      const end = body.indexOf("*/", i);
      if (end < 0) return { handlerName: null, decorators };
      i = end + 2;
      continue;
    }
    const word = readIdentifier(body, i);
    if (word === "async" || word === "public" || word === "private" || word === "protected") {
      i += word.length;
      continue;
    }
    if (word) return { handlerName: word, decorators };
    return { handlerName: null, decorators };
  }
  return { handlerName: null, decorators };
}

/**
 * Walk forward from `openIndex` (which must point at `(`) to the
 * matching `)`. Tolerant of nested parens, strings, line + block
 * comments. Returns the index of the matching `)`, or -1 if not found.
 */
function matchClosingParen(source: string, openIndex: number): number {
  let depth = 0;
  let i = openIndex;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "/" && source[i + 1] === "/") {
      const eol = source.indexOf("\n", i);
      i = eol < 0 ? source.length : eol + 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(source, i);
      continue;
    }
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function readIdentifier(body: string, from: number): string | null {
  const re = /[A-Za-z_$][A-Za-z0-9_$]*/y;
  re.lastIndex = from;
  const m = re.exec(body);
  return m?.[0] ?? null;
}

/**
 * Walk backward from `httpDecoratorIndex` collecting decorators that
 * sit on contiguous lines above the HTTP-method decorator. Stops at
 * the first non-decorator, non-whitespace line.
 *
 * Returns the decorator stack with the order preserved (top-most
 * decorator first, http decorator last) — but for this planner only
 * the names + args matter, so the order is informative only.
 */
function collectStackedDecorators(
  body: string,
  httpDecoratorIndex: number,
): Array<{ name: string; args: string }> {
  const stack: Array<{ name: string; args: string }> = [];

  // Step backwards line-by-line. A decorator runs from `@<Name>(...)`
  // to the matching `)`; we collect the whole token, then peek above
  // it. If the line above is blank or contains a non-decorator token,
  // we stop.
  let cursor = httpDecoratorIndex;
  while (cursor > 0) {
    // Find the start of the previous logical decorator. Walk back
    // skipping whitespace, then check for a `)` (end of a decorator).
    let i = cursor - 1;
    while (i >= 0 && (body[i] === " " || body[i] === "\t" || body[i] === "\n" || body[i] === "\r"))
      i--;
    if (i < 0) break;
    if (body[i] !== ")") break;
    // Walk back to the matching `(`.
    const openParen = matchOpeningParen(body, i);
    if (openParen < 0) break;
    // The decorator name sits immediately before the open paren —
    // walk back over identifier chars and the `@`.
    let j = openParen - 1;
    while (j >= 0 && /[A-Za-z0-9_$]/.test(body[j] ?? "")) j--;
    if (body[j] !== "@") break;
    const name = body.slice(j + 1, openParen);
    const args = body.slice(openParen + 1, i);
    stack.unshift({ name, args });
    cursor = j;
  }

  return stack;
}

/**
 * Walk forward from `openIndex` (which must point at `{`) to the
 * matching `}`. Tolerant of nested braces, strings, line + block
 * comments. Returns the index of the matching `}`, or -1 if not found.
 */
function matchClosingBrace(source: string, openIndex: number): number {
  let depth = 0;
  let i = openIndex;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "/" && source[i + 1] === "/") {
      const eol = source.indexOf("\n", i);
      i = eol < 0 ? source.length : eol + 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(source, i);
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Walk backward from `closeIndex` (which must point at `)`) to the
 * matching `(`. Naive (no string handling) but adequate for decorator
 * argument lists where strings rarely contain unbalanced parens.
 */
function matchOpeningParen(source: string, closeIndex: number): number {
  let depth = 0;
  for (let i = closeIndex; i >= 0; i--) {
    const ch = source[i];
    if (ch === ")") depth++;
    else if (ch === "(") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function skipString(source: string, openIndex: number): number {
  const quote = source[openIndex];
  let i = openIndex + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i++;
  }
  return source.length;
}

function lineNumberFromIndex(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

function joinControllerPath(basePath: string, handlerPath: string): string {
  const base = basePath.replace(/^\/+/, "").replace(/\/+$/, "");
  const handler = handlerPath.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!base && !handler) return "/";
  if (!base) return `/${handler}`;
  if (!handler) return `/${base}`;
  return `/${base}/${handler}`;
}

function matchAllowlist(
  path: string,
  prefixes: readonly string[],
  exact: ReadonlySet<string>,
): string | undefined {
  if (exact.has(path)) return path;
  for (const prefix of prefixes) {
    if (path.startsWith(prefix)) return prefix;
    // Allow the prefix-without-trailing-slash form to match the bare
    // controller path (e.g. `/admin/` covers `/admin`).
    if (prefix.endsWith("/") && path === prefix.slice(0, -1)) return prefix;
  }
  return undefined;
}
