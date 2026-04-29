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

  describe("Terminal-style fixed-height + auto-tail (DX optimisation)", () => {
    // Why: previously the table grew until the page had to scroll —
    // newest entries kept landing below the fold. Behaviour now:
    //   - the table sits inside a viewport-bound scroll container
    //   - the <thead> stays visible while the body scrolls
    //   - new records auto-scroll to the bottom WHEN the user is
    //     already at the bottom (terminal-style follow-tail)
    //   - if the user scrolls up to read older entries, the page
    //     does NOT yank them down on the next poll
    it("wraps the table in a height-bound scroll container", () => {
      const records = [{ level: 30, time: 1_777_000_000_000, msg: "x", seq: 1 }];
      const html = renderLogViewerPage({ records, bufferCapacity: 500, bufferSize: 1 });
      expect(html).toContain("log-scroll");
      // Container caps the height so the latest row is immediately visible.
      expect(html).toMatch(/\.log-scroll[^}]*max-height:/);
    });

    it("makes the <thead> sticky inside the scroll container", () => {
      const records = [{ level: 30, time: 1_777_000_000_000, msg: "x", seq: 1 }];
      const html = renderLogViewerPage({ records, bufferCapacity: 500, bufferSize: 1 });
      expect(html).toMatch(/\.log-table\s+thead[^}]*position:\s*sticky/);
    });

    it("ships a follow-tail script that scrolls the container, not the page", () => {
      const records = [{ level: 30, time: 1_777_000_000_000, msg: "x", seq: 1 }];
      const html = renderLogViewerPage({ records, bufferCapacity: 500, bufferSize: 1 });
      // Selector for the new container, used by the polling script.
      expect(html).toContain("[data-log-scroll]");
      // The script tracks "is the user at the bottom?" so it can
      // skip the auto-scroll when the user has scrolled up.
      expect(html).toMatch(/followTail|atBottom|isAtBottom/);
    });
  });
});
