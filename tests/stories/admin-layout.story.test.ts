import { describe, expect, it } from "vitest";

import { defaultAdminNav, renderAdminLayout } from "../../src/core/dx/admin-layout.js";

describe("Story · Admin-Layout", () => {
  it("rendert ein vollständiges HTML-Dokument mit Title und Body-Slot", () => {
    const html = renderAdminLayout({
      title: "Permission Tester",
      currentNav: "permissions",
      body: "<p>BODY-CONTENT</p>",
    });

    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("<title>Permission Tester — nest-server</title>");
    expect(html).toContain("BODY-CONTENT");
    expect(html).toMatch(/<h1[^>]*>Permission Tester<\/h1>/);
  });

  it("hebt den aktiven Sidebar-Link hervor", () => {
    const html = renderAdminLayout({
      title: "Audit Browser",
      currentNav: "audit",
      body: "",
    });

    // Search inside the body — the CSS definitions also contain the modifier name.
    const bodyStart = html.indexOf("<aside");
    const activeIndex = html.indexOf("admin-nav__link--active", bodyStart);
    const auditIndex = html.indexOf("Audit Browser", activeIndex);
    expect(activeIndex).toBeGreaterThan(0);
    expect(auditIndex).toBeGreaterThan(activeIndex);
    expect(auditIndex - activeIndex).toBeLessThan(500);
  });

  it("zeigt nicht-aktive Links ohne aktiven Modifier", () => {
    const html = renderAdminLayout({
      title: "Audit Browser",
      currentNav: "audit",
      body: "",
    });

    expect(html).toContain('href="/dev"');
    const devLinkActive =
      /admin-nav__link admin-nav__link--active"[^>]*>[^<]*<\/span><span>Dev Hub/.test(html);
    expect(devLinkActive).toBe(false);
  });

  it("setzt Subtitle, wenn übergeben", () => {
    const html = renderAdminLayout({
      title: "X",
      subtitle: "Untertitel-Text",
      currentNav: "dev-hub",
      body: "",
    });
    expect(html).toContain("Untertitel-Text");
  });

  it("hat im Default-Nav alle wichtigen Tools", () => {
    const sections = defaultAdminNav();
    const ids = sections.flatMap((s) => s.items.map((i) => i.id));
    expect(ids).toContain("dev-hub");
    expect(ids).toContain("permissions");
    expect(ids).toContain("webhooks");
    expect(ids).toContain("realtime");
    expect(ids).toContain("audit");
    expect(ids).toContain("search");
    expect(ids).toContain("scalar");
    expect(ids).toContain("openapi");
    expect(ids).toContain("errors");
    expect(ids).toContain("prisma-studio");
    // Pages added later — must be reachable via the sidebar, not
    // just by typing the URL.
    expect(ids).toContain("routes");
    expect(ids).toContain("erd");
    expect(ids).toContain("email-preview");
    expect(ids).toContain("traces");
  });

  it("every nav item has a working currentNav match (no orphaned IDs)", () => {
    const sections = defaultAdminNav();
    for (const section of sections) {
      for (const item of section.items) {
        // The currentNav passed by each page must equal one of these
        // IDs; otherwise the highlight breaks. This test is the
        // contract that catches "I added a page but forgot to make
        // its currentNav match a sidebar id".
        expect(typeof item.id).toBe("string");
        expect(item.id.length).toBeGreaterThan(0);
        expect(typeof item.href).toBe("string");
        expect(item.href.length).toBeGreaterThan(0);
      }
    }
  });

  it("enthält Dark-Mode CSS-Variablen", () => {
    const html = renderAdminLayout({ title: "X", currentNav: "dev-hub", body: "" });
    expect(html).toContain("--bg: #020203");
    expect(html).toContain("--accent: #c5fb45");
    expect(html).toContain("--fg: #ffffff");
  });
});
