/**
 * `/dev/tests` — verbatim React port of `test-summary-ui.ts`. Same
 * 4-tile totals (tests / passed / failed / duration), same files
 * table sorted failures-first inside a sticky-header scroll
 * container with optional failure-snippet `<pre>`.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson, formatTestDuration } from "../lib/api.js";

interface TotalShape {
  tests: number;
  passed: number;
  failed: number;
  durationMs: number;
  success: boolean;
}

interface TestFileRow {
  path: string;
  status: "passed" | "failed";
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  failureSnippet?: string;
}

interface TestSummary {
  available: boolean;
  generatedAt?: string;
  totals: TotalShape;
  files: TestFileRow[];
}

export function TestsPage(): ReactNode {
  const data = useQuery({
    queryKey: ["dev", "tests"],
    queryFn: () => fetchJson<TestSummary>("/dev/tests.json"),
  });

  const subtitle = data.data
    ? data.data.available
      ? `Vitest ${data.data.totals.success ? "passed" : "failed"} — ${data.data.totals.passed}/${data.data.totals.tests} tests, ${formatTestDuration(data.data.totals.durationMs)}`
      : "Run `bun run test:summary` to populate this page."
    : "Loading…";

  return (
    <AdminShell title="Tests" subtitle={subtitle} currentNav="tests">
      {data.data ? (
        data.data.available ? (
          <TestsBody report={data.data} />
        ) : (
          <div className="admin-empty">
            Test summary not generated yet.
            <br />
            Run <code>bun run test:summary</code> to populate the dashboard.
          </div>
        )
      ) : data.isError ? (
        <div className="admin-empty">Failed to load test summary.</div>
      ) : (
        <div className="admin-empty">Loading test summary…</div>
      )}
    </AdminShell>
  );
}

function TestsBody({ report }: { report: TestSummary }): ReactNode {
  const t = report.totals;
  return (
    <>
      <div className="admin-card">
        <h2 className="admin-card__title">
          Totals
          {t.success ? (
            <span className="test-pill test-pill--passed">✓ all green</span>
          ) : (
            <span className="test-pill test-pill--failed">✗ failures</span>
          )}
        </h2>
        <div className="test-totals">
          <div className="test-tile test-tile--neutral">
            <div className="test-tile__label">Tests</div>
            <div className="test-tile__value">{t.tests}</div>
          </div>
          <div className="test-tile test-tile--ok">
            <div className="test-tile__label">Passed</div>
            <div className="test-tile__value">{t.passed}</div>
          </div>
          <div className="test-tile test-tile--bad">
            <div className="test-tile__label">Failed</div>
            <div className="test-tile__value">{t.failed}</div>
          </div>
          <div className="test-tile test-tile--neutral">
            <div className="test-tile__label">Duration</div>
            <div className="test-tile__value">{formatTestDuration(t.durationMs)}</div>
          </div>
        </div>
      </div>

      <div className="admin-card">
        <h2 className="admin-card__title">Files ({report.files.length}, fehler zuerst)</h2>
        {report.files.length === 0 ? (
          <div className="admin-empty">No file-level data in summary.</div>
        ) : (
          <div className="test-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>File</th>
                  <th>Pass</th>
                  <th>Fail</th>
                  <th>Skip</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {report.files.map((file) => (
                  <tr
                    key={file.path}
                    className={file.status === "failed" ? "test-row--failed" : ""}
                  >
                    <td>
                      {file.status === "passed" ? (
                        <span className="test-pill test-pill--passed">passed</span>
                      ) : (
                        <span className="test-pill test-pill--failed">failed</span>
                      )}
                    </td>
                    <td>
                      <code>{file.path}</code>
                      {file.failureSnippet ? (
                        <pre className="test-snippet">{file.failureSnippet}</pre>
                      ) : null}
                    </td>
                    <td>{file.passed}</td>
                    <td>{file.failed}</td>
                    <td>{file.skipped}</td>
                    <td>{formatTestDuration(file.durationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
