import { describe, expect, it } from "vitest";

import { renderDashboardPage } from "../../src/core/dx/dashboard-ui.js";
import { buildCoverageReport } from "../../src/core/dx/coverage-report.js";
import { buildTestSummary } from "../../src/core/dx/test-summary.js";
import { loadFeatures } from "../../src/core/features/features.js";

const baseInput = () => ({
  baseUrl: "http://localhost:3000",
  uptimeMs: 90 * 1000,
  memory: { heapUsed: 60 * 1024 * 1024, heapTotal: 100 * 1024 * 1024, rss: 200 * 1024 * 1024 },
  process: { node: "v22.0.0", bun: "1.1.0", platform: "darwin" },
  features: loadFeatures({}),
  probes: [
    { id: "api", label: "API", category: "core" as const, status: "up" as const, latencyMs: 12 },
    {
      id: "database",
      label: "Postgres",
      category: "core" as const,
      status: "up" as const,
      latencyMs: 30,
    },
  ],
  coverage: buildCoverageReport({ repoRoot: "/r" }),
  tests: buildTestSummary({ repoRoot: "/r" }),
  logs: [],
  logBufferCapacity: 500,
  queries: { total: 0, slowestMs: 0, warnCount: 0, badCount: 0 },
});

describe("Story · Dashboard UI", () => {
  it("rendert Hero + Stats + Services + Logs + Features als ein Cockpit", () => {
    const html = renderDashboardPage(baseInput());
    expect(html).toMatch(/All systems operational/);
    expect(html).toContain('data-service-status="true"');
    expect(html).toMatch(/Live logs/);
    expect(html).toMatch(/Features/);
    expect(html).toMatch(/Quick navigation/);
  });

  it("zeigt 'Issues detected' wenn ein Service down ist", () => {
    const input = baseInput();
    const html = renderDashboardPage({
      ...input,
      probes: [
        ...input.probes,
        {
          id: "x",
          label: "Down",
          category: "tooling" as const,
          status: "down" as const,
          latencyMs: 0,
        },
      ],
    });
    expect(html).toMatch(/Issues detected/);
    expect(html).toMatch(/1 service\(s\) offline/);
    expect(html).toContain("hero--err");
  });

  it("zeigt Coverage-Pill 'no run yet' wenn nicht verfügbar", () => {
    const html = renderDashboardPage(baseInput());
    expect(html).toContain("no run yet");
  });

  it("verlinkt jeden Stat auf seine Detail-Seite", () => {
    const html = renderDashboardPage(baseInput());
    // stat-cards are <a class="stat-card" href="…">
    expect(html).toMatch(/<a class="stat-card" href="\/dev\/coverage"/);
    expect(html).toMatch(/<a class="stat-card" href="\/dev\/tests"/);
    expect(html).toMatch(/<a class="stat-card" href="\/dev\/features"/);
    expect(html).toMatch(/<a class="stat-card" href="\/dev\/logs"/);
  });

  it("formatiert Uptime menschenlesbar", () => {
    const html = renderDashboardPage({
      ...baseInput(),
      uptimeMs: 3 * 60 * 60 * 1000 + 25 * 60_000,
    });
    expect(html).toMatch(/3h 25m/);
  });

  it("eskapiert User-Input gegen XSS", () => {
    const html = renderDashboardPage({
      ...baseInput(),
      logs: [{ level: 50, time: 1_777_000_000_000, msg: "<script>alert(1)</script>", seq: 1 }],
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
