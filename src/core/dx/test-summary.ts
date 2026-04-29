/**
 * Test-Summary planner.
 *
 * Parses Vitest's JSON-reporter output (saved to
 * `coverage/test-summary.json` by `bun run test:summary`) into a
 * UI-friendly struct: per-file aggregates, totals, the worst-status
 * test, and pass/fail tallies.
 *
 * The reporter's record format (Vitest 4) groups assertion results
 * under `testResults: [{ assertionResults, name, status, ... }]`.
 * Anything we don't recognize is ignored — empty inputs return an
 * `available: false` report so the dashboard shows a hint instead of
 * crashing.
 */

export interface RawAssertion {
  status: "passed" | "failed" | "skipped" | "pending" | "todo";
  fullName?: string;
  title?: string;
  duration?: number;
  failureMessages?: string[];
}

export interface RawTestFile {
  /** Absolute file path. */
  name?: string;
  status?: "passed" | "failed";
  startTime?: number;
  endTime?: number;
  assertionResults?: RawAssertion[];
  message?: string;
}

export interface RawTestSummary {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  numTodoTests?: number;
  numTotalTestSuites?: number;
  numPassedTestSuites?: number;
  numFailedTestSuites?: number;
  startTime?: number;
  testResults?: RawTestFile[];
  success?: boolean;
}

export interface TestFileRow {
  /** Repo-relative path. */
  path: string;
  status: "passed" | "failed";
  durationMs: number;
  passed: number;
  failed: number;
  skipped: number;
  /** First failure message, if any (truncated to ~400 chars). */
  failureSnippet?: string;
}

export interface TestSummaryReport {
  available: boolean;
  generatedAt?: string;
  totals: {
    tests: number;
    passed: number;
    failed: number;
    pending: number;
    suitesTotal: number;
    suitesPassed: number;
    suitesFailed: number;
    durationMs: number;
    success: boolean;
  };
  files: TestFileRow[];
}

export interface TestSummaryInput {
  /** Parsed JSON. */
  summary?: RawTestSummary;
  repoRoot: string;
  generatedAt?: string;
}

const DEFAULT_TOTALS: TestSummaryReport["totals"] = {
  tests: 0,
  passed: 0,
  failed: 0,
  pending: 0,
  suitesTotal: 0,
  suitesPassed: 0,
  suitesFailed: 0,
  durationMs: 0,
  success: false,
};

export function buildTestSummary(input: TestSummaryInput): TestSummaryReport {
  if (!input.summary) {
    return { available: false, totals: { ...DEFAULT_TOTALS }, files: [] };
  }
  const s = input.summary;
  const files: TestFileRow[] = [];
  let durationMs = 0;
  for (const file of s.testResults ?? []) {
    if (!file?.name) continue;
    const path = relativize(file.name, input.repoRoot);
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let snippet: string | undefined;
    for (const a of file.assertionResults ?? []) {
      if (a.status === "passed") passed++;
      else if (a.status === "failed") {
        failed++;
        if (!snippet && a.failureMessages?.[0]) {
          snippet = truncate(a.failureMessages[0], 400);
        }
      } else skipped++;
    }
    const status: TestFileRow["status"] =
      file.status === "failed" || failed > 0 ? "failed" : "passed";
    const fileDuration =
      file.endTime !== undefined && file.startTime !== undefined
        ? Math.max(0, file.endTime - file.startTime)
        : 0;
    durationMs += fileDuration;
    files.push({
      path,
      status,
      durationMs: fileDuration,
      passed,
      failed,
      skipped,
      ...(snippet ? { failureSnippet: snippet } : {}),
    });
  }
  // Failed suites first, then slowest first inside each bucket.
  files.sort((a, b) => {
    if (a.status !== b.status) return a.status === "failed" ? -1 : 1;
    return b.durationMs - a.durationMs;
  });

  return {
    available: true,
    ...(input.generatedAt ? { generatedAt: input.generatedAt } : {}),
    totals: {
      tests: s.numTotalTests ?? files.reduce((acc, f) => acc + f.passed + f.failed + f.skipped, 0),
      passed: s.numPassedTests ?? files.reduce((acc, f) => acc + f.passed, 0),
      failed: s.numFailedTests ?? files.reduce((acc, f) => acc + f.failed, 0),
      pending: (s.numPendingTests ?? 0) + (s.numTodoTests ?? 0),
      suitesTotal: s.numTotalTestSuites ?? files.length,
      suitesPassed: s.numPassedTestSuites ?? files.filter((f) => f.status === "passed").length,
      suitesFailed: s.numFailedTestSuites ?? files.filter((f) => f.status === "failed").length,
      durationMs,
      success: s.success ?? files.every((f) => f.status === "passed"),
    },
    files,
  };
}

function relativize(absPath: string, repoRoot: string): string {
  const root = repoRoot.endsWith("/") ? repoRoot : `${repoRoot}/`;
  return absPath.startsWith(root) ? absPath.slice(root.length) : absPath;
}

function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, max - 1)}…`;
}
