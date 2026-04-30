#!/usr/bin/env bun
/**
 * `bun run llm-test` — runs an autonomous Claude Code session against
 * the test plan-doc, captures the friction log, prints a summary.
 *
 * Uses your local Claude CLI auth (no API key). The CLI must be on
 * `PATH` and you must already be logged in.
 *
 * Workspace defaults to `~/.cache/lt-llm-test/run-<timestamp>/`. Override
 * with `--workspace <path>`. The workspace gets cleaned up at the end
 * (friction.md + transcript.jsonl move to `~/.cache/lt-llm-test/archive/`)
 * unless `--keep-workspace` is set.
 *
 * Wallclock cap: 90 min by default (override with `--timeout <minutes>`).
 * The session can also be aborted with Ctrl-C; the script kills the
 * Claude subprocess cleanly and still emits the partial summary.
 */

import {
  appendFileSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

interface CliArgs {
  keepWorkspace: boolean;
  timeoutMinutes: number;
  workspace?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { keepWorkspace: false, timeoutMinutes: 90 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--workspace') args.workspace = argv[++i];
    else if (flag === '--keep-workspace') args.keepWorkspace = true;
    else if (flag === '--timeout') args.timeoutMinutes = Number(argv[++i]);
    else if (flag === '--help' || flag === '-h') {
      console.log(
        'Usage: bun run llm-test [--workspace <path>] [--keep-workspace] [--timeout <minutes>]',
      );
      process.exit(0);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const ROOT = process.cwd();
const PLAN_DOC = resolve(ROOT, 'tests/llm-feature-test/plan-doc.md');
const HOME = homedir();
const CACHE_ROOT = resolve(HOME, '.cache/lt-llm-test');
const ARCHIVE_ROOT = resolve(CACHE_ROOT, 'archive');

if (!existsSync(PLAN_DOC)) {
  console.error(`[llm-test] plan-doc not found at ${PLAN_DOC}`);
  process.exit(1);
}

// Verify `claude` is on PATH. We don't try to verify auth — the CLI
// will fail loud at first request if you're not logged in.
const which = await Bun.spawn(['which', 'claude'], { stdio: ['ignore', 'pipe', 'inherit'] }).exited;
if (which !== 0) {
  console.error('[llm-test] `claude` CLI not found on PATH.');
  console.error('[llm-test] Install it from https://docs.claude.com/ or run `npm i -g @anthropic-ai/claude-code`.');
  process.exit(1);
}

const timestamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const workspace = args.workspace ? resolve(args.workspace) : resolve(CACHE_ROOT, `run-${timestamp}`);

mkdirSync(workspace, { recursive: true });
mkdirSync(ARCHIVE_ROOT, { recursive: true });

writeFileSync(resolve(workspace, 'plan-doc.md'), readFileSync(PLAN_DOC, 'utf8'), 'utf8');

console.log(`[llm-test] workspace:  ${workspace}`);
console.log(`[llm-test] plan-doc:   ${PLAN_DOC}`);
console.log(`[llm-test] timeout:    ${args.timeoutMinutes} min wallclock`);
console.log('[llm-test] starting headless Claude session (Ctrl-C to abort)');
console.log('');

const kickoff = `You are a fresh agent. The current directory contains a \`plan-doc.md\` —
read it once, then execute it autonomously without asking for confirmation.

The plan tells you to scaffold a project via \`lt fullstack init --next\`,
build a multi-tenant Todo app inside this workspace, and maintain a friction
log at \`./friction.md\` (relative to this directory). Append to that file as
you go — one entry per friction, written immediately when encountered.

Stop when one of these is true:
  - all acceptance criteria from plan-doc.md are green;
  - you hit a blocker that requires human input;
  - the friction log is dense enough that more iterations would be noise.

Begin now.`;

// Ensure the transcript file exists from second 0, even before any
// stream-json events have been emitted. `appendFileSync` per event
// keeps each line durable on disk so a hard SIGKILL of this script
// (or its parent shell) never loses more than the line currently
// being written. Buffering would lose the tail.
const transcriptPath = resolve(workspace, 'transcript.jsonl');
closeSync(openSync(transcriptPath, 'a'));
const startedAt = Date.now();

const proc = Bun.spawn(
  [
    'claude',
    '--print',
    '--verbose', // required for --output-format=stream-json
    '--permission-mode', 'acceptEdits',
    '--allowed-tools', 'Bash,Read,Edit,Write,Glob,Grep',
    '--add-dir', workspace,
    '--output-format', 'stream-json',
    kickoff,
  ],
  {
    cwd: workspace,
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);

// Wallclock kill switch.
const killTimer = setTimeout(
  () => {
    console.log('');
    console.log(`[llm-test] Wallclock timeout (${args.timeoutMinutes} min) — terminating.`);
    proc.kill('SIGTERM');
  },
  args.timeoutMinutes * 60_000,
);

// Ctrl-C / TERM handlers — kill the child cleanly, let the main
// loop drain, run the archive step. Hard SIGKILL of this process is
// the only path that skips archiving; in that case the workspace
// dir is left intact at ~/.cache/lt-llm-test/run-<ts>/ so the user
// can still recover friction.md + transcript.jsonl manually.
let aborted = false;
const abort = (signal: string) => {
  if (aborted) return;
  aborted = true;
  console.log('');
  console.log(`[llm-test] ${signal} received — terminating Claude session.`);
  proc.kill('SIGTERM');
};
process.on('SIGINT', () => abort('SIGINT'));
process.on('SIGTERM', () => abort('SIGTERM'));

// Stream parser.
let turn = 0;
let buffer = '';
const decoder = new TextDecoder();
const reader = proc.stdout.getReader();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });

  let nl: number;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    if (!line.trim()) continue;
    // Synchronous append: the transcript stays durable line-by-line
    // even if a hard kill cuts us off mid-stream.
    appendFileSync(transcriptPath, `${line}\n`);

    let event: { type?: string; message?: { content?: unknown[] }; subtype?: string };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
      for (const block of event.message.content) {
        const b = block as { type: string; text?: string; name?: string; input?: unknown };
        if (b.type === 'text' && b.text) {
          turn += 1;
          console.log(`[turn ${turn}] ${b.text.replace(/\s+/g, ' ').trim()}`);
        } else if (b.type === 'tool_use' && b.name) {
          turn += 1;
          const summary = summarizeTool(b.name, b.input);
          console.log(`[turn ${turn}] tool: ${b.name.padEnd(8)} ▶ ${summary}`);
        }
      }
    }
  }
}

clearTimeout(killTimer);

const exitCode = await proc.exited;
const wallclockSec = Math.round((Date.now() - startedAt) / 1000);

console.log('');
console.log(
  `[llm-test] Session ended (exit ${exitCode}, ${Math.floor(wallclockSec / 60)}m${wallclockSec % 60}s wallclock)`,
);

// Friction-log summary.
const frictionPath = resolve(workspace, 'friction.md');
const entries = existsSync(frictionPath) ? parseFrictionLog(readFileSync(frictionPath, 'utf8')) : [];

const SEVERITY_ORDER = ['blocker', 'high', 'medium', 'low', 'nit', 'unknown'] as const;
const counts = new Map<string, number>();
for (const e of entries) counts.set(e.severity, (counts.get(e.severity) ?? 0) + 1);

console.log('');
console.log(`[llm-test] Friction log: ${entries.length} entries`);
for (const sev of SEVERITY_ORDER) {
  const n = counts.get(sev) ?? 0;
  if (n > 0) console.log(`[llm-test]   ${sev.padEnd(7)}: ${n}`);
}

const top = entries.find(
  (e) => e.severity === 'blocker' || e.severity === 'high',
);
if (top) {
  console.log('');
  console.log(`[llm-test] Top finding (${top.severity}):`);
  console.log(`[llm-test]   ${top.title}`);
}

// Archive friction + transcript regardless of cleanup mode.
const archiveDir = resolve(ARCHIVE_ROOT, timestamp);
mkdirSync(archiveDir, { recursive: true });
if (existsSync(frictionPath)) cpSync(frictionPath, resolve(archiveDir, 'friction.md'));
cpSync(transcriptPath, resolve(archiveDir, 'transcript.jsonl'));

console.log('');
console.log(`[llm-test] Friction:   ${resolve(archiveDir, 'friction.md')}`);
console.log(`[llm-test] Transcript: ${resolve(archiveDir, 'transcript.jsonl')}`);

if (args.keepWorkspace) {
  console.log(`[llm-test] Workspace:  ${workspace} (kept — --keep-workspace)`);
} else {
  rmSync(workspace, { recursive: true, force: true });
  console.log('[llm-test] Workspace cleaned up (use --keep-workspace to preserve).');
}

process.exit(exitCode === null ? 1 : exitCode);

// ───────────────────────────────────────────────────────────────────────
// Helpers

function summarizeTool(name: string, rawInput: unknown): string {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  const truncate = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
  switch (name) {
    case 'Bash':
      return truncate(String(input.command ?? ''), 100);
    case 'Read':
    case 'Write':
      return truncate(String(input.file_path ?? ''), 100);
    case 'Edit': {
      const path = String(input.file_path ?? '');
      const oldStr = String(input.old_string ?? '');
      return `${truncate(path, 60)} (${oldStr.length}b → ${String(input.new_string ?? '').length}b)`;
    }
    case 'Glob':
    case 'Grep':
      return truncate(String(input.pattern ?? ''), 100);
    default:
      return truncate(JSON.stringify(input), 100);
  }
}

interface FrictionEntry {
  severity: string;
  title: string;
}

function parseFrictionLog(md: string): FrictionEntry[] {
  // Match either `### YYYY-MM-DDThh:mm · area · title` or
  // `### YYYY-MM-DD · area · title`.
  const headingRe = /^### \d{4}-\d{2}-\d{2}(?:T[\d:.-]*)? · [^·]+ · (.+)$/gm;
  const sections: { body: string; title: string }[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = headingRe.exec(md)) !== null) {
    if (sections.length > 0) {
      sections[sections.length - 1]!.body = md.slice(lastIndex, match.index);
    }
    sections.push({ body: '', title: match[1]!.trim() });
    lastIndex = match.index + match[0].length;
  }
  if (sections.length > 0) {
    sections[sections.length - 1]!.body = md.slice(lastIndex);
  }

  return sections.map((s) => {
    const sevMatch = s.body.match(/^- \*\*Severity:\*\*\s*(\w+)/m);
    return {
      severity: (sevMatch?.[1] ?? 'unknown').toLowerCase(),
      title: s.title,
    };
  });
}
