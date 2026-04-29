import { describe, expect, it } from "vitest";

import { renderLogViewerPage } from "../../src/core/dx/log-viewer-ui.js";

describe("Story · Log-Viewer UI", () => {
  it("zeigt Empty-Hint, wenn Buffer leer", () => {
    const html = renderLogViewerPage({ records: [], bufferCapacity: 500, bufferSize: 0 });
    expect(html).toMatch(/No records yet/i);
  });

  it("rendert Records mit Level-spezifischer Klasse und data-log-tail", () => {
    const records = [
      { level: 30, time: 1_777_000_000_000, msg: "info-line", context: "App", seq: 1 },
      { level: 50, time: 1_777_000_000_001, msg: "boom", context: "App", seq: 2 },
    ];
    const html = renderLogViewerPage({ records, bufferCapacity: 500, bufferSize: 2 });
    expect(html).toMatch(/data-log-tail="true"/);
    expect(html).toContain("info-line");
    expect(html).toContain("boom");
    expect(html).toContain("log-row--info");
    expect(html).toContain("log-row--error");
  });

  it("eskapiert User-Input gegen XSS", () => {
    const records = [
      { level: 30, time: 1_777_000_000_000, msg: "<script>alert(1)</script>", seq: 1 },
    ];
    const html = renderLogViewerPage({ records, bufferCapacity: 500, bufferSize: 1 });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("zeigt Buffer-Zähler (Größe / Kapazität)", () => {
    const html = renderLogViewerPage({ records: [], bufferCapacity: 500, bufferSize: 42 });
    expect(html).toMatch(/42\s*\/\s*500/);
  });
});
