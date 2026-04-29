import { describe, expect, it } from "vitest";

import { renderJsonViewerPage, renderValue } from "../../src/core/dx/json-viewer-ui.js";

describe("Story · JSON-Viewer", () => {
  it("rendert ein vollständiges HTML-Dokument mit Toolbar und Code-Block", () => {
    const html = renderJsonViewerPage({
      title: "Errors",
      currentNav: "errors",
      value: { code: "CORE_NOT_FOUND" },
    });
    expect(html).toMatch(/<title>Errors — nest-server<\/title>/);
    expect(html).toContain('class="jv__root"');
    expect(html).toContain('id="jv-filter"');
    expect(html).toContain('data-jv-action="copy"');
  });

  it("highlightet keys, strings, numbers, booleans, null", () => {
    const html = renderValue({ a: "x", b: 7, c: true, d: null }, 0);
    expect(html).toContain('class="jv__key">&quot;a&quot;');
    expect(html).toContain('class="jv__string">&quot;x&quot;');
    expect(html).toContain('class="jv__number">7');
    expect(html).toContain('class="jv__boolean">true');
    expect(html).toContain('class="jv__null">null');
  });

  it("rendert leere Strukturen kompakt", () => {
    expect(renderValue({}, 0)).toContain('class="jv__brace">{}</span>');
    expect(renderValue([], 0)).toContain('class="jv__brace">[]</span>');
  });

  it("kollabiert tiefe Strukturen ab depth 3 standardmäßig", () => {
    const deep = { a: { b: { c: { d: 1 } } } };
    const html = renderValue(deep, 0);
    // Depth-3 node ({ d: 1 }) sollte data-collapsed="true" haben
    const collapsedCount = (html.match(/data-collapsed="true"/g) ?? []).length;
    expect(collapsedCount).toBeGreaterThanOrEqual(1);
  });

  it("schützt vor Zyklen", () => {
    const cyc: { self?: unknown } = {};
    cyc.self = cyc;
    const html = renderValue(cyc, 0);
    expect(html).toContain("[Circular]");
  });

  it("eskapiert XSS-Inhalte sicher", () => {
    const html = renderValue({ msg: "<script>alert(1)</script>" }, 0);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("zeigt rawJsonHref Link, wenn übergeben", () => {
    const html = renderJsonViewerPage({
      title: "X",
      currentNav: "errors",
      value: {},
      rawJsonHref: "/errors.json",
    });
    expect(html).toContain('href="/errors.json"');
    expect(html).toMatch(/Raw \.json/);
  });

  it("akzeptiert prelude HTML als zusätzlichen Block über dem Viewer", () => {
    const html = renderJsonViewerPage({
      title: "X",
      currentNav: "errors",
      value: {},
      prelude: '<p class="my-hint">HINT-MARKER</p>',
    });
    expect(html).toContain("HINT-MARKER");
    // Prelude muss vor dem viewer stehen
    expect(html.indexOf("HINT-MARKER")).toBeLessThan(html.indexOf("jv__root"));
  });
});
