/**
 * Pure planner for in-place `.env` file updates.
 *
 * Receives the current text of an .env file plus a single
 * KEY=value patch and returns the new text. Behaviour:
 *   - existing line is replaced (preserves position + trailing comment)
 *   - missing key is appended at the bottom under a "managed" section
 *   - blank file gets the value added
 *   - whitespace and comment lines around the key are preserved
 *
 * No I/O. Tests run with explicit string fixtures; the runner does
 * `readFile` / `writeFile` around the planner.
 */

export interface EnvUpdateInput {
  /** Current `.env` content (may be empty). */
  current: string;
  /** Key to patch — uppercase, no `=`. */
  key: string;
  /** New value. Spaces are preserved as-is; quote externally if needed. */
  value: string;
}

export interface EnvUpdatePlan {
  next: string;
  /** "replaced" if the key existed before, "appended" if it was added new. */
  action: "replaced" | "appended";
  /** 1-based line number of the affected line in the new content. */
  lineNumber: number;
}

const KEY_RE = /^[A-Z0-9_]+$/;
const ASSIGN_RE = /^([A-Z0-9_]+)\s*=(.*)$/;

export function planEnvFileUpdate(input: EnvUpdateInput): EnvUpdatePlan {
  if (!KEY_RE.test(input.key)) {
    throw new Error(`env-file-update: invalid key "${input.key}" (uppercase + underscore only)`);
  }
  if (input.value.includes("\n")) {
    throw new Error(`env-file-update: value must not contain newlines`);
  }
  const lines = input.current === "" ? [] : input.current.split(/\r?\n/);
  const trailingNewline = input.current.endsWith("\n") || input.current === "";
  const stripped =
    trailingNewline && lines.length > 0 && lines[lines.length - 1] === ""
      ? lines.slice(0, -1)
      : lines;

  for (let i = 0; i < stripped.length; i++) {
    const raw = stripped[i] ?? "";
    if (raw.startsWith("#")) continue;
    const m = ASSIGN_RE.exec(raw);
    if (!m) continue;
    if (m[1] === input.key) {
      const newLine = `${input.key}=${input.value}`;
      stripped[i] = preserveTrailingComment(raw, newLine);
      return {
        next: stripped.join("\n") + (trailingNewline ? "\n" : ""),
        action: "replaced",
        lineNumber: i + 1,
      };
    }
  }
  // Append under a managed marker so the auto-managed area stays grouped.
  const marker = "# Managed by /dev/features";
  const hasMarker = stripped.some((l) => l.trim() === marker);
  const block: string[] = [];
  if (stripped.length > 0 && stripped[stripped.length - 1] !== "") block.push("");
  if (!hasMarker) block.push(marker);
  block.push(`${input.key}=${input.value}`);
  const next = [...stripped, ...block].join("\n") + (trailingNewline ? "\n" : "");
  return {
    next,
    action: "appended",
    lineNumber: stripped.length + block.length,
  };
}

/**
 * Preserves a trailing `# comment` if the original line had one. Whitespace
 * before the comment is preserved as-is (a single space is the typical case).
 */
function preserveTrailingComment(originalLine: string, newAssignment: string): string {
  const eqIdx = originalLine.indexOf("=");
  if (eqIdx < 0) return newAssignment;
  const valueAndAfter = originalLine.slice(eqIdx + 1);
  const commentIdx = findCommentStart(valueAndAfter);
  if (commentIdx < 0) return newAssignment;
  const trailing = valueAndAfter.slice(commentIdx);
  return `${newAssignment}${stripSurroundingSpaces(valueAndAfter, commentIdx)}${trailing}`;
}

function findCommentStart(value: string): number {
  // simple scan — does not honour `=` style escaping inside strings, but
  // the .env files we patch never use that.
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === "#" && !inDouble && !inSingle) return i;
  }
  return -1;
}

function stripSurroundingSpaces(valueAndAfter: string, commentIdx: number): string {
  // Insert a single space between value and comment.
  let i = commentIdx - 1;
  while (i >= 0 && valueAndAfter[i] === " ") i--;
  return i >= 0 ? " " : "";
}
