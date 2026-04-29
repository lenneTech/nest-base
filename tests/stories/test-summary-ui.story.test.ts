import { describe, expect, it } from "vitest";

import { buildTestSummary, type RawTestSummary } from "../../src/core/dx/test-summary.js";
import { renderTestSummaryPage } from "../../src/core/dx/test-summary-ui.js";

describe("Story · Test-Summary UI", () => {
  it("zeigt Empty-State wenn kein Summary vorhanden", () => {
    const html = renderTestSummaryPage(buildTestSummary({ repoRoot: "/r" }));
    expect(html).toMatch(/Test summary not generated/i);
    expect(html).toMatch(/bun run test:summary/);
  });

  it("rendert Totals-Tiles und data-test-files Tabelle", () => {
    const summary: RawTestSummary = {
      numTotalTests: 5,
      numPassedTests: 5,
      numFailedTests: 0,
      success: true,
      testResults: [
        {
          name: "/r/tests/foo.spec.ts",
          status: "passed",
          startTime: 0,
          endTime: 100,
          assertionResults: [{ status: "passed" }],
        },
      ],
    };
    const html = renderTestSummaryPage(buildTestSummary({ summary, repoRoot: "/r" }));
    expect(html).toMatch(/data-test-files="true"/);
    expect(html).toContain("tests/foo.spec.ts");
    expect(html).toMatch(/all green/i);
  });

  it("hebt fehlgeschlagene Suites mit eigener Klasse hervor und zeigt Snippet", () => {
    const summary: RawTestSummary = {
      success: false,
      testResults: [
        {
          name: "/r/tests/bad.spec.ts",
          status: "failed",
          assertionResults: [{ status: "failed", failureMessages: ["AssertionError: kapuuuut"] }],
        },
      ],
    };
    const html = renderTestSummaryPage(buildTestSummary({ summary, repoRoot: "/r" }));
    expect(html).toContain("test-row--failed");
    expect(html).toContain("kapuuuut");
    expect(html).toMatch(/✗ failures/);
  });

  it("eskapiert Pfade und Failure-Snippets", () => {
    const summary: RawTestSummary = {
      testResults: [
        {
          name: "/r/tests/<x>.spec.ts",
          status: "failed",
          assertionResults: [
            {
              status: "failed",
              failureMessages: ["<script>alert(1)</script>"],
            },
          ],
        },
      ],
    };
    const html = renderTestSummaryPage(buildTestSummary({ summary, repoRoot: "/r" }));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
