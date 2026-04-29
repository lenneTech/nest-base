import { describe, expect, it } from "vitest";

import { buildTestSummary, type RawTestSummary } from "../../src/core/dx/test-summary.js";

const repoRoot = "/repo";

describe("Story · Test-Summary", () => {
  it("liefert `available: false` ohne Summary", () => {
    expect(buildTestSummary({ repoRoot })).toMatchObject({
      available: false,
      totals: { tests: 0, success: false },
      files: [],
    });
  });

  it("aggregiert Totals aus Vitest-Reporter-Output", () => {
    const summary: RawTestSummary = {
      numTotalTests: 10,
      numPassedTests: 9,
      numFailedTests: 1,
      numPendingTests: 0,
      numTotalTestSuites: 2,
      numPassedTestSuites: 1,
      numFailedTestSuites: 1,
      success: false,
      testResults: [
        {
          name: "/repo/tests/foo.spec.ts",
          status: "passed",
          startTime: 0,
          endTime: 50,
          assertionResults: [
            { status: "passed", fullName: "a" },
            { status: "passed", fullName: "b" },
          ],
        },
        {
          name: "/repo/tests/bar.spec.ts",
          status: "failed",
          startTime: 0,
          endTime: 30,
          assertionResults: [
            { status: "failed", fullName: "boom", failureMessages: ["AssertionError: bad"] },
          ],
        },
      ],
    };
    const r = buildTestSummary({ summary, repoRoot });
    expect(r.available).toBe(true);
    expect(r.totals.tests).toBe(10);
    expect(r.totals.passed).toBe(9);
    expect(r.totals.failed).toBe(1);
    expect(r.totals.suitesPassed).toBe(1);
    expect(r.totals.suitesFailed).toBe(1);
    expect(r.totals.success).toBe(false);
  });

  it("relativiert Pfade gegen Repo-Root", () => {
    const summary: RawTestSummary = {
      testResults: [
        {
          name: "/repo/tests/foo.spec.ts",
          status: "passed",
          assertionResults: [{ status: "passed" }],
        },
      ],
    };
    const r = buildTestSummary({ summary, repoRoot });
    expect(r.files[0]?.path).toBe("tests/foo.spec.ts");
  });

  it("sortiert: failed zuerst, dann nach Duration absteigend", () => {
    const summary: RawTestSummary = {
      testResults: [
        {
          name: "/repo/tests/fast-pass.spec.ts",
          status: "passed",
          startTime: 0,
          endTime: 10,
          assertionResults: [{ status: "passed" }],
        },
        {
          name: "/repo/tests/slow-pass.spec.ts",
          status: "passed",
          startTime: 0,
          endTime: 200,
          assertionResults: [{ status: "passed" }],
        },
        {
          name: "/repo/tests/fail.spec.ts",
          status: "failed",
          startTime: 0,
          endTime: 5,
          assertionResults: [{ status: "failed", failureMessages: ["err"] }],
        },
      ],
    };
    const r = buildTestSummary({ summary, repoRoot });
    expect(r.files.map((f) => f.path)).toEqual([
      "tests/fail.spec.ts",
      "tests/slow-pass.spec.ts",
      "tests/fast-pass.spec.ts",
    ]);
  });

  it("kürzt Failure-Snippet auf max. ~400 Zeichen", () => {
    const long = "x".repeat(800);
    const summary: RawTestSummary = {
      testResults: [
        {
          name: "/repo/tests/fail.spec.ts",
          status: "failed",
          assertionResults: [{ status: "failed", failureMessages: [long] }],
        },
      ],
    };
    const r = buildTestSummary({ summary, repoRoot });
    expect(r.files[0]?.failureSnippet?.length).toBeLessThanOrEqual(400);
    expect(r.files[0]?.failureSnippet?.endsWith("…")).toBe(true);
  });
});
