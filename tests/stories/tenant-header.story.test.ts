import { describe, expect, it } from "vitest";

import {
  TenantIsolationError,
  parseTenantHeader,
  resolveTenantHeaderName,
} from "../../src/core/multi-tenancy/tenant-header.js";

/**
 * Story · Tenant-Header parsing.
 *
 * The header value flows into Postgres as `SET app.tenant_id = $1`,
 * which RLS policies then compare against the row's `tenant_id`
 * column. Postgres' `uuid` type normalises to lowercase, but any code
 * that string-compares the raw header (session caches, audit emitters)
 * would mismatch on mixed-case input. So we lowercase at the parse
 * boundary.
 *
 * Error messages must NOT echo the raw input — newlines could
 * forge log lines (log-injection), and reflecting bad input weakens
 * defense-in-depth.
 */
describe("Story · Tenant-Header parser", () => {
  describe("resolveTenantHeaderName", () => {
    it("returns the name configured in features.multiTenancy.headerName", () => {
      expect(
        resolveTenantHeaderName({
          multiTenancy: { enabled: true, rls: true, headerName: "x-tenant-id" },
        }),
      ).toBe("x-tenant-id");
    });
  });

  describe("parseTenantHeader — happy path", () => {
    it("returns a lowercase canonical UUID when given a lowercase UUID", () => {
      const tenantId = "0af76519-16cd-43dd-8448-eb211c80319c";
      expect(parseTenantHeader(tenantId)).toBe(tenantId);
    });

    it("normalises uppercase UUID to lowercase (RLS canonical form)", () => {
      // Why: Postgres' `uuid` type normalises internally, but any code
      // that string-compares the header value (session caches, audit
      // emitters, request-context echoes) would mismatch on mixed
      // case. We lowercase at the parse boundary so every consumer
      // sees the canonical form.
      const upper = "0AF76519-16CD-43DD-8448-EB211C80319C";
      expect(parseTenantHeader(upper)).toBe(upper.toLowerCase());
    });

    it("normalises mixed-case UUID to lowercase", () => {
      expect(parseTenantHeader("0Af76519-16cd-43DD-8448-eb211C80319c")).toBe(
        "0af76519-16cd-43dd-8448-eb211c80319c",
      );
    });

    it("uses the first entry when the header is supplied as an array", () => {
      expect(parseTenantHeader(["0af76519-16cd-43dd-8448-eb211c80319c", "ignored-second"])).toBe(
        "0af76519-16cd-43dd-8448-eb211c80319c",
      );
    });
  });

  describe("parseTenantHeader — rejection", () => {
    it("throws when the header is missing", () => {
      expect(() => parseTenantHeader(undefined)).toThrow(TenantIsolationError);
    });

    it("throws when the header is empty", () => {
      expect(() => parseTenantHeader("")).toThrow(TenantIsolationError);
    });

    it("throws when the header is not a UUID", () => {
      expect(() => parseTenantHeader("not-a-uuid")).toThrow(TenantIsolationError);
    });

    it("error message does NOT reflect the raw input (log-injection prevention)", () => {
      // Why: an attacker can stuff CRLF + a forged log line into the
      // header. If the error message includes `received: ${raw}` and
      // gets logged unstructured, log-aggregation tools see two
      // synthetic log entries.
      try {
        parseTenantHeader("evil\r\nFAKE-LOG-LINE injected=true");
        throw new Error("expected TenantIsolationError");
      } catch (err) {
        expect(err).toBeInstanceOf(TenantIsolationError);
        const message = (err as Error).message;
        expect(message).not.toContain("FAKE-LOG-LINE");
        expect(message).not.toContain("\n");
        expect(message).not.toContain("\r");
      }
    });
  });
});
