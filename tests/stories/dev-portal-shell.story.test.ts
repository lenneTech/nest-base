import { describe, expect, it } from "vitest";

import {
  buildDevPortalShellInput,
  renderDevPortalShell,
  type DevPortalShellInput,
} from "../../src/core/dx/dev-portal-shell.js";

/**
 * Story · Dev-Portal Shell renderer.
 *
 * Pure planner: takes the design-token CSS, the script URL, the page
 * title, and a few build-time hints, produces the static HTML skeleton
 * that boots the React SPA. No NestJS, no I/O.
 *
 * The shell is the security boundary between dev-portal and the rest
 * of the surface — it must HTML-escape every caller-controlled value
 * (title, scriptUrl, tokenCss path) so a misconfigured controller
 * cannot inject markup.
 */
describe("Story · Dev-Portal Shell", () => {
  function input(overrides: Partial<DevPortalShellInput> = {}): DevPortalShellInput {
    return {
      title: "Dev Portal",
      scriptUrl: "/hub/static/main.js",
      tokenCssUrl: "/hub/static/tokens.css",
      ...overrides,
    };
  }

  it("renders a complete HTML5 document", () => {
    const html = renderDevPortalShell(input());
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    expect(html).toContain('<meta charset="utf-8">');
  });

  it("includes the React mount point with id=root", () => {
    const html = renderDevPortalShell(input());
    expect(html).toMatch(/<div id="root"><\/div>/);
  });

  it("loads the bundle as type=module", () => {
    const html = renderDevPortalShell(input());
    expect(html).toMatch(/<script\s+type="module"\s+src="\/hub\/static\/main\.js"><\/script>/);
  });

  it("includes the design-token stylesheet via <link rel=stylesheet>", () => {
    const html = renderDevPortalShell(input());
    expect(html).toMatch(/<link\s+rel="stylesheet"\s+href="\/hub\/static\/tokens\.css">/);
  });

  it("uses the supplied title in <title>", () => {
    const html = renderDevPortalShell(input({ title: "Hello" }));
    expect(html).toContain("<title>Hello — nest-server</title>");
  });

  it("HTML-escapes the title to prevent injection", () => {
    const html = renderDevPortalShell(input({ title: "<script>alert(1)</script>" }));
    // Raw markup must not appear; escaped form must.
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("HTML-escapes scriptUrl and tokenCssUrl quote characters", () => {
    const html = renderDevPortalShell(
      input({
        scriptUrl: '/hub/static/main.js" onload="x',
        tokenCssUrl: '/hub/static/tokens.css" onload="y',
      }),
    );
    expect(html).not.toContain('onload="x');
    expect(html).not.toContain('onload="y');
    expect(html).toContain("&quot;");
  });

  it("includes the dark-mode shell background variable inline so first paint matches the SPA", () => {
    const html = renderDevPortalShell(input());
    // The shell always emits a tiny inline <style> with the background
    // colour so the page never flashes white before the bundle hydrates.
    expect(html).toMatch(/<style>[^<]*body\s*\{[^}]*background:\s*#020203/);
  });

  it("declares a noscript fallback so the page is honest when JS is disabled", () => {
    const html = renderDevPortalShell(input());
    expect(html).toMatch(/<noscript>/);
    expect(html).toMatch(/JavaScript/i);
  });

  it("uses lang=de on the <html> element to match the rest of the dev surface", () => {
    const html = renderDevPortalShell(input());
    expect(html).toMatch(/<html\s+lang="de"/);
  });

  it("buildDevPortalShellInput defaults the static base path and title", () => {
    const built = buildDevPortalShellInput({});
    expect(built.title).toBe("Dev Portal");
    // Issue #83: all API routes (including dev static assets) live under /api/*
    expect(built.scriptUrl).toBe("/api/hub/static/main.js");
    expect(built.tokenCssUrl).toBe("/api/hub/static/tokens.css");
  });

  it("buildDevPortalShellInput respects custom title overrides", () => {
    const built = buildDevPortalShellInput({ title: "Components" });
    expect(built.title).toBe("Components");
  });
});
