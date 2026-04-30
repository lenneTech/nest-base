import { describe, expect, it } from "vitest";

import {
  renderRealtimeInspectorPage,
  type ActiveSocketEntry,
  type RealtimeEventEntry,
  type RealtimeInspectorPageInput,
} from "../../src/core/dx/realtime-inspector-ui.js";

/**
 * Story · Realtime-Inspector UI.
 *
 * Pure HTML renderer for the `/admin/realtime` page. Two read models
 * land here:
 *
 *   - active sockets: snapshot taken from the SocketGateway's
 *     subscriber registry (or a permission-filtered view of it)
 *   - recent events: last-N events the RealtimeService dispatched
 *     locally — fed in by the controller, kept short
 *
 * The inspector is a read-only diagnostics surface today. A future
 * slice can add disconnect actions; the renderer leaves the markup
 * door open with a per-row `data-socket-id` hook.
 */
describe("Story · Realtime-Inspector UI", () => {
  function input(overrides: Partial<RealtimeInspectorPageInput> = {}): RealtimeInspectorPageInput {
    return { sockets: [], events: [], ...overrides };
  }

  function socket(overrides: Partial<ActiveSocketEntry> = {}): ActiveSocketEntry {
    return {
      id: "s-1",
      userId: "u-1",
      tenantId: "t-1",
      channels: ["Project:tenant:t-1"],
      connectedAt: "2026-04-28T12:00:00Z",
      ...overrides,
    };
  }

  function event(overrides: Partial<RealtimeEventEntry> = {}): RealtimeEventEntry {
    return {
      channel: "Project:tenant:t-1",
      eventType: "project.updated",
      payloadPreview: '{"id":"p-1"}',
      occurredAt: "2026-04-28T12:00:01Z",
      ...overrides,
    };
  }

  describe("document chrome", () => {
    it("emits a complete HTML document", () => {
      const html = renderRealtimeInspectorPage(input());
      expect(html).toMatch(/^<!doctype html>/i);
      expect(html).toMatch(/<\/html>\s*$/);
    });

    it('uses "Realtime Inspector" as the page title', () => {
      expect(renderRealtimeInspectorPage(input())).toMatch(/<title>[^<]*Realtime Inspector/);
    });

    it("includes a back-link to the Dev-Hub", () => {
      expect(renderRealtimeInspectorPage(input())).toMatch(/href=["']\/dev["']/);
    });

    it("embeds a meta-refresh so the inspector stays current without JS", () => {
      const html = renderRealtimeInspectorPage(input({ refreshSeconds: 5 }));
      expect(html).toMatch(/<meta http-equiv=["']refresh["'] content=["']5["']/);
    });

    it("omits the meta-refresh when refreshSeconds is not set", () => {
      const html = renderRealtimeInspectorPage(input());
      expect(html).not.toMatch(/<meta http-equiv=["']refresh["']/);
    });
  });

  describe("active sockets table", () => {
    it("shows an empty state when no sockets are connected", () => {
      const html = renderRealtimeInspectorPage(input({ sockets: [] }));
      expect(html).toMatch(/no.*active.*socket/i);
    });

    it("renders one row per socket with id / user / tenant / connectedAt", () => {
      const html = renderRealtimeInspectorPage(
        input({
          sockets: [
            socket({
              id: "s-aa",
              userId: "u-aa",
              tenantId: "t-aa",
              connectedAt: "2026-04-28T10:00:00Z",
            }),
          ],
        }),
      );
      expect(html).toContain("s-aa");
      expect(html).toContain("u-aa");
      expect(html).toContain("t-aa");
      expect(html).toContain("2026-04-28T10:00:00Z");
    });

    it("lists each socket's subscribed channels", () => {
      const html = renderRealtimeInspectorPage(
        input({ sockets: [socket({ channels: ["Project:tenant:t-1", "User:item:u-1"] })] }),
      );
      expect(html).toContain("Project:tenant:t-1");
      expect(html).toContain("User:item:u-1");
    });

    it("shows the active-socket count", () => {
      const html = renderRealtimeInspectorPage(
        input({ sockets: [socket({ id: "s-1" }), socket({ id: "s-2" }), socket({ id: "s-3" })] }),
      );
      expect(html).toMatch(/3.*active/i);
    });

    it("attaches a `data-socket-id` hook to each row so future actions can target it", () => {
      const html = renderRealtimeInspectorPage(input({ sockets: [socket({ id: "s-target" })] }));
      expect(html).toMatch(/data-socket-id=["']s-target["']/);
    });
  });

  describe("recent events stream", () => {
    it("shows an empty state when no events", () => {
      const html = renderRealtimeInspectorPage(input({ events: [] }));
      expect(html).toMatch(/no.*recent.*event/i);
    });

    it("renders one row per event with channel / type / preview / occurredAt", () => {
      const html = renderRealtimeInspectorPage(
        input({
          events: [
            event({
              channel: "Order:tenant:t-1",
              eventType: "order.placed",
              payloadPreview: '{"id":"o-7"}',
            }),
          ],
        }),
      );
      expect(html).toContain("Order:tenant:t-1");
      expect(html).toContain("order.placed");
      // Payload preview is HTML-escaped — the literal JSON quotes become &quot;
      expect(html).toContain("{&quot;id&quot;:&quot;o-7&quot;}");
    });

    it("preserves event order (newest-first is the controller's job)", () => {
      const html = renderRealtimeInspectorPage(
        input({
          events: [event({ eventType: "aaa.event" }), event({ eventType: "zzz.event" })],
        }),
      );
      expect(html.indexOf("aaa.event")).toBeLessThan(html.indexOf("zzz.event"));
    });
  });

  describe("XSS safety", () => {
    it("escapes channel / userId / payloadPreview", () => {
      const malicious = "<img src=x onerror=alert(1)>";
      const html = renderRealtimeInspectorPage(
        input({
          sockets: [socket({ id: malicious, userId: malicious, channels: [malicious] })],
          events: [event({ channel: malicious, eventType: malicious, payloadPreview: malicious })],
        }),
      );
      expect(html).not.toContain("<img src=x onerror=alert(1)>");
      expect(html).toContain("&lt;img");
    });
  });
});
