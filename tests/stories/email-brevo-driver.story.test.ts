import { describe, expect, it } from "vitest";

import {
  BrevoApiError,
  BrevoEmailDriver,
  BrevoMissingApiKeyError,
  composeBrevoSendPayload,
  composeBrevoTemplatePayload,
  mapBrevoTemplate,
  type BrevoHttpClient,
} from "../../src/core/email/drivers/brevo.driver.js";

/**
 * Story · BrevoEmailDriver.
 *
 * Brevo is HTTP-only — every method goes through `https://api.brevo.com`.
 * The driver hides the HTTP client behind a `BrevoHttpClient` interface
 * so tests can stub responses without `nock`/`msw`. Payload-shaping +
 * response-mapping are extracted into pure helpers (planner pattern):
 *
 *   composeBrevoSendPayload(msg)              → /v3/smtp/email body
 *   composeBrevoTemplatePayload(msg, id, vars)→ /v3/smtp/email body
 *   mapBrevoTemplate(rawJson)                 → BrevoTemplate
 *
 * Read-side methods (`listTemplates`, `getTemplate`) feed Issue #9's
 * Brevo-Read-Only-Tab — they must work even when Brevo is the inactive
 * driver, but they always require a valid API key.
 */
describe("Story · BrevoEmailDriver", () => {
  function fakeHttp(
    handler: (req: { method: string; path: string; body?: unknown }) => Promise<{
      status: number;
      body: unknown;
    }>,
  ): BrevoHttpClient & { calls: Array<{ method: string; path: string; body?: unknown }> } {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    return {
      calls,
      async request(req) {
        calls.push(req);
        return handler(req);
      },
    };
  }

  describe("composeBrevoSendPayload (pure planner)", () => {
    it("shapes the /v3/smtp/email body with sender + recipient + content", () => {
      expect(
        composeBrevoSendPayload({
          to: "user@example.com",
          from: "noreply@example.com",
          subject: "hi",
          html: "<p>hi</p>",
          text: "hi",
        }),
      ).toEqual({
        sender: { email: "noreply@example.com" },
        to: [{ email: "user@example.com" }],
        subject: "hi",
        htmlContent: "<p>hi</p>",
        textContent: "hi",
      });
    });

    it("omits htmlContent / textContent when not provided", () => {
      const body = composeBrevoSendPayload({
        to: "u@example.com",
        from: "noreply@example.com",
        subject: "s",
      });
      expect(body).not.toHaveProperty("htmlContent");
      expect(body).not.toHaveProperty("textContent");
    });
  });

  describe("composeBrevoTemplatePayload (pure planner)", () => {
    it("references templateId and forwards vars as params", () => {
      expect(
        composeBrevoTemplatePayload(
          { to: "u@example.com", from: "noreply@example.com", subject: "" },
          42,
          { name: "Pascal", url: "https://x" },
        ),
      ).toEqual({
        sender: { email: "noreply@example.com" },
        to: [{ email: "u@example.com" }],
        templateId: 42,
        params: { name: "Pascal", url: "https://x" },
      });
    });
  });

  describe("mapBrevoTemplate (pure planner)", () => {
    it("normalises Brevo's API JSON into our internal shape", () => {
      const raw = {
        id: 7,
        name: "welcome",
        subject: "Welcome to Brevo",
        isActive: true,
        htmlContent: "<p>hi</p>",
        replyTo: "support@example.com",
        sender: { name: "Support", email: "support@example.com" },
        createdAt: "2025-01-01T00:00:00Z",
        modifiedAt: "2025-02-01T00:00:00Z",
      };
      expect(mapBrevoTemplate(raw)).toEqual({
        id: 7,
        name: "welcome",
        subject: "Welcome to Brevo",
        isActive: true,
        htmlContent: "<p>hi</p>",
        replyTo: "support@example.com",
        sender: { name: "Support", email: "support@example.com" },
        createdAt: "2025-01-01T00:00:00Z",
        modifiedAt: "2025-02-01T00:00:00Z",
      });
    });

    it("tolerates missing optional fields", () => {
      const raw = { id: 1, name: "x", subject: "s", isActive: false };
      const mapped = mapBrevoTemplate(raw);
      expect(mapped.id).toBe(1);
      expect(mapped.htmlContent).toBeUndefined();
      expect(mapped.sender).toBeUndefined();
    });

    it("throws when required fields are missing", () => {
      expect(() => mapBrevoTemplate({ name: "x" })).toThrow(/id/);
    });
  });

  describe("send()", () => {
    it("POSTs /v3/smtp/email with composed payload and returns Brevo's messageId", async () => {
      const http = fakeHttp(async () => ({
        status: 201,
        body: { messageId: "<201501225173628.5510706700@smtp-relay.mailin.fr>" },
      }));
      const driver = new BrevoEmailDriver({ apiKey: "xkeysib-...", http });
      const result = await driver.send({
        to: "u@example.com",
        from: "noreply@example.com",
        subject: "hi",
        text: "hello",
      });
      expect(http.calls).toHaveLength(1);
      expect(http.calls[0]).toMatchObject({
        method: "POST",
        path: "/v3/smtp/email",
      });
      expect(http.calls[0]?.body).toMatchObject({
        sender: { email: "noreply@example.com" },
        to: [{ email: "u@example.com" }],
        subject: "hi",
        textContent: "hello",
      });
      expect(result.driver).toBe("brevo");
      expect(result.messageId).toContain("smtp-relay.mailin.fr");
    });

    it("wraps non-2xx responses in BrevoApiError with the response body", async () => {
      const http = fakeHttp(async () => ({
        status: 401,
        body: { code: "unauthorized", message: "Key not found" },
      }));
      const driver = new BrevoEmailDriver({ apiKey: "xkeysib-bad", http });
      await expect(
        driver.send({
          to: "u@example.com",
          from: "noreply@example.com",
          subject: "s",
          text: "t",
        }),
      ).rejects.toThrow(BrevoApiError);
    });

    it("throws BrevoMissingApiKeyError when no api key is configured", async () => {
      const driver = new BrevoEmailDriver({
        apiKey: "",
        http: fakeHttp(async () => ({ status: 0, body: {} })),
      });
      await expect(
        driver.send({
          to: "u@example.com",
          from: "noreply@example.com",
          subject: "s",
          text: "t",
        }),
      ).rejects.toThrow(BrevoMissingApiKeyError);
    });
  });

  describe("sendTemplate()", () => {
    it("POSTs /v3/smtp/email with templateId + params", async () => {
      const http = fakeHttp(async () => ({ status: 201, body: { messageId: "tpl-msg" } }));
      const driver = new BrevoEmailDriver({ apiKey: "xkeysib-...", http });
      const result = await driver.sendTemplate(
        { to: "u@example.com", from: "noreply@example.com", subject: "" },
        42,
        { name: "Pascal" },
      );
      expect(http.calls[0]?.body).toMatchObject({
        templateId: 42,
        params: { name: "Pascal" },
      });
      expect(result.driver).toBe("brevo");
      expect(result.messageId).toBe("tpl-msg");
    });
  });

  describe("listTemplates()", () => {
    it("calls GET /v3/smtp/templates with limit + offset query and maps the result", async () => {
      const http = fakeHttp(async () => ({
        status: 200,
        body: {
          count: 1,
          templates: [
            {
              id: 1,
              name: "welcome",
              subject: "Welcome",
              isActive: true,
            },
          ],
        },
      }));
      const driver = new BrevoEmailDriver({ apiKey: "xkeysib-...", http });
      const list = await driver.listTemplates({ limit: 50, offset: 0 });
      expect(http.calls[0]).toMatchObject({
        method: "GET",
        path: "/v3/smtp/templates?limit=50&offset=0",
      });
      expect(list).toEqual([{ id: 1, name: "welcome", subject: "Welcome", isActive: true }]);
    });

    it("throws BrevoMissingApiKeyError when called without a key", async () => {
      const driver = new BrevoEmailDriver({
        apiKey: "",
        http: fakeHttp(async () => ({ status: 0, body: {} })),
      });
      await expect(driver.listTemplates({})).rejects.toThrow(BrevoMissingApiKeyError);
    });
  });

  describe("getTemplate()", () => {
    it("fetches a single template with full HTML body", async () => {
      const http = fakeHttp(async () => ({
        status: 200,
        body: {
          id: 7,
          name: "welcome",
          subject: "Welcome",
          htmlContent: "<p>welcome</p>",
          isActive: true,
        },
      }));
      const driver = new BrevoEmailDriver({ apiKey: "xkeysib-...", http });
      const tpl = await driver.getTemplate(7);
      expect(http.calls[0]).toMatchObject({
        method: "GET",
        path: "/v3/smtp/templates/7",
      });
      expect(tpl.htmlContent).toBe("<p>welcome</p>");
    });

    it("throws BrevoMissingApiKeyError when called without a key", async () => {
      const driver = new BrevoEmailDriver({
        apiKey: "",
        http: fakeHttp(async () => ({ status: 0, body: {} })),
      });
      await expect(driver.getTemplate(1)).rejects.toThrow(BrevoMissingApiKeyError);
    });
  });

  describe("driver name", () => {
    it("identifies itself as 'brevo'", () => {
      const driver = new BrevoEmailDriver({
        apiKey: "xkeysib-...",
        http: fakeHttp(async () => ({ status: 200, body: {} })),
      });
      expect(driver.name).toBe("brevo");
    });
  });
});
