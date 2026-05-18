import { describe, expect, it } from "vitest";

import {
  InvalidWebhookUrlError,
  validateWebhookUrl,
} from "../../src/core/webhooks/webhook-url-validator.js";

/**
 * Story · Webhook URL Validator (CRIT-3 SSRF prevention).
 *
 * `WebhookDispatcher.dispatch()` calls `validateWebhookUrl()` before
 * issuing the HTTP POST. The validator blocks:
 *   - non-http(s) protocols
 *   - localhost / loopback addresses
 *   - RFC-1918 private IP ranges
 *   - link-local (169.254.x.x, fe80::/10)
 *   - cloud-metadata endpoints
 *   - carrier-grade NAT (100.64.x.x)
 *
 * Valid public URLs pass through unchanged.
 */
describe("Story · Webhook URL Validator", () => {
  describe("valid URLs", () => {
    it("accepts https on a public hostname", () => {
      expect(() => validateWebhookUrl("https://example.com/webhook")).not.toThrow();
    });

    it("accepts http on a public hostname", () => {
      expect(() => validateWebhookUrl("http://api.example.org/events")).not.toThrow();
    });

    it("accepts a URL with a port", () => {
      expect(() => validateWebhookUrl("https://example.com:8443/webhook")).not.toThrow();
    });

    it("accepts a URL with a path and query string", () => {
      expect(() =>
        validateWebhookUrl("https://hooks.example.com/v1/events?token=abc"),
      ).not.toThrow();
    });
  });

  describe("invalid protocols", () => {
    it("rejects file:// URLs", () => {
      expect(() => validateWebhookUrl("file:///etc/passwd")).toThrow(InvalidWebhookUrlError);
    });

    it("rejects ftp:// URLs", () => {
      expect(() => validateWebhookUrl("ftp://example.com")).toThrow(InvalidWebhookUrlError);
    });

    it("rejects data: URLs", () => {
      expect(() => validateWebhookUrl("data:text/plain,hello")).toThrow(InvalidWebhookUrlError);
    });
  });

  describe("malformed URLs", () => {
    it("rejects a bare string with no protocol", () => {
      expect(() => validateWebhookUrl("not-a-url")).toThrow(InvalidWebhookUrlError);
    });

    it("rejects an empty string", () => {
      expect(() => validateWebhookUrl("")).toThrow(InvalidWebhookUrlError);
    });
  });

  describe("loopback and localhost", () => {
    it("rejects localhost", () => {
      expect(() => validateWebhookUrl("http://localhost/webhook")).toThrow(InvalidWebhookUrlError);
    });

    it("rejects 127.0.0.1", () => {
      expect(() => validateWebhookUrl("http://127.0.0.1/webhook")).toThrow(InvalidWebhookUrlError);
    });

    it("rejects 127.x.x.x variants", () => {
      expect(() => validateWebhookUrl("http://127.0.0.2/webhook")).toThrow(InvalidWebhookUrlError);
    });

    it("rejects ::1 IPv6 loopback", () => {
      expect(() => validateWebhookUrl("http://[::1]/webhook")).toThrow(InvalidWebhookUrlError);
    });

    it("rejects 0.0.0.0", () => {
      expect(() => validateWebhookUrl("http://0.0.0.0/webhook")).toThrow(InvalidWebhookUrlError);
    });
  });

  describe("RFC-1918 private ranges", () => {
    it("rejects 10.x.x.x", () => {
      expect(() => validateWebhookUrl("http://10.0.0.1/webhook")).toThrow(InvalidWebhookUrlError);
    });

    it("rejects 172.16.x.x", () => {
      expect(() => validateWebhookUrl("http://172.16.0.1/webhook")).toThrow(InvalidWebhookUrlError);
    });

    it("rejects 172.31.x.x", () => {
      expect(() => validateWebhookUrl("http://172.31.255.255/webhook")).toThrow(
        InvalidWebhookUrlError,
      );
    });

    it("does not block 172.32.x.x (outside private range)", () => {
      expect(() => validateWebhookUrl("https://172.32.0.1/webhook")).not.toThrow();
    });

    it("rejects 192.168.x.x", () => {
      expect(() => validateWebhookUrl("http://192.168.1.1/webhook")).toThrow(
        InvalidWebhookUrlError,
      );
    });
  });

  describe("link-local", () => {
    it("rejects 169.254.x.x (APIPA / cloud metadata link-local)", () => {
      expect(() => validateWebhookUrl("http://169.254.169.254/latest/meta-data/")).toThrow(
        InvalidWebhookUrlError,
      );
    });
  });

  describe("cloud metadata endpoints", () => {
    it("rejects metadata.google.internal", () => {
      expect(() => validateWebhookUrl("http://metadata.google.internal/")).toThrow(
        InvalidWebhookUrlError,
      );
    });

    it("rejects metadata.internal (generic pattern)", () => {
      expect(() => validateWebhookUrl("http://metadata.internal/")).toThrow(InvalidWebhookUrlError);
    });
  });

  describe("carrier-grade NAT (RFC 6598)", () => {
    it("rejects 100.64.x.x", () => {
      expect(() => validateWebhookUrl("http://100.64.0.1/webhook")).toThrow(InvalidWebhookUrlError);
    });
  });

  describe("error type", () => {
    it("throws InvalidWebhookUrlError (not a generic Error)", () => {
      try {
        validateWebhookUrl("http://localhost/bad");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidWebhookUrlError);
        expect((err as InvalidWebhookUrlError).name).toBe("InvalidWebhookUrlError");
        expect((err as InvalidWebhookUrlError).message).toMatch(/localhost/i);
      }
    });
  });
});
