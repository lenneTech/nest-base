/**
 * Story · File share-link signing + verification (CF.FILES.06 —
 * iter-112). Pure planner, no I/O — assertions land on the wire
 * format + the security envelope (signature mismatch + expiry).
 */
import { describe, expect, it } from "vitest";

import {
  ExpiredShareLinkError,
  InvalidShareLinkError,
  signShareLink,
  verifyShareLink,
} from "../../src/core/files/share-link.js";

const SECRET = "test-secret-do-not-rotate";
const FILE_ID = "file-uuid-1";
const TENANT_ID = "tenant-uuid-1";

describe("Story · share-link planner", () => {
  describe("signShareLink", () => {
    it("emits a 4-segment dot-separated token (fileId.tenantId.expiresAt.sig)", () => {
      const token = signShareLink({
        fileId: FILE_ID,
        tenantId: TENANT_ID,
        expiresAtMs: 1_700_000_000_000,
        secret: SECRET,
      });
      const parts = token.split(".");
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe(FILE_ID);
      expect(parts[1]).toBe(TENANT_ID);
      expect(parts[2]).toBe("1700000000000");
      expect(parts[3]).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("is deterministic for the same inputs", () => {
      const a = signShareLink({
        fileId: "f",
        tenantId: "t",
        expiresAtMs: 100,
        secret: SECRET,
      });
      const b = signShareLink({
        fileId: "f",
        tenantId: "t",
        expiresAtMs: 100,
        secret: SECRET,
      });
      expect(a).toBe(b);
    });

    it("changes signature when the secret rotates", () => {
      const a = signShareLink({ fileId: "f", tenantId: "t", expiresAtMs: 100, secret: "s1" });
      const b = signShareLink({ fileId: "f", tenantId: "t", expiresAtMs: 100, secret: "s2" });
      expect(a).not.toBe(b);
    });

    it("changes signature when the tenantId differs (no cross-tenant token reuse)", () => {
      const a = signShareLink({ fileId: "f", tenantId: "t1", expiresAtMs: 100, secret: SECRET });
      const b = signShareLink({ fileId: "f", tenantId: "t2", expiresAtMs: 100, secret: SECRET });
      expect(a).not.toBe(b);
    });

    it("rejects empty fileId / tenantId / secret / non-positive expiresAtMs", () => {
      expect(() =>
        signShareLink({ fileId: "", tenantId: "t", expiresAtMs: 1, secret: SECRET }),
      ).toThrow(InvalidShareLinkError);
      expect(() =>
        signShareLink({ fileId: "x", tenantId: "", expiresAtMs: 1, secret: SECRET }),
      ).toThrow(InvalidShareLinkError);
      expect(() =>
        signShareLink({ fileId: "x", tenantId: "t", expiresAtMs: 1, secret: "" }),
      ).toThrow(InvalidShareLinkError);
      expect(() =>
        signShareLink({ fileId: "x", tenantId: "t", expiresAtMs: 0, secret: SECRET }),
      ).toThrow(InvalidShareLinkError);
    });
  });

  describe("verifyShareLink", () => {
    const EXPIRES_AT = 1_700_000_000_000;
    const TOKEN = signShareLink({
      fileId: FILE_ID,
      tenantId: TENANT_ID,
      expiresAtMs: EXPIRES_AT,
      secret: SECRET,
    });

    it("returns the {fileId, tenantId, expiresAtMs} on a valid, in-window token", () => {
      const result = verifyShareLink({
        token: TOKEN,
        secret: SECRET,
        nowMs: EXPIRES_AT - 1_000,
      });
      expect(result).toEqual({
        fileId: FILE_ID,
        tenantId: TENANT_ID,
        expiresAtMs: EXPIRES_AT,
      });
    });

    it("throws ExpiredShareLinkError once nowMs >= expiresAtMs", () => {
      expect(() => verifyShareLink({ token: TOKEN, secret: SECRET, nowMs: EXPIRES_AT })).toThrow(
        ExpiredShareLinkError,
      );
    });

    it("throws InvalidShareLinkError on signature mismatch (wrong secret)", () => {
      expect(() =>
        verifyShareLink({ token: TOKEN, secret: "different", nowMs: EXPIRES_AT - 1 }),
      ).toThrow(InvalidShareLinkError);
    });

    it("throws InvalidShareLinkError on tampered fileId segment", () => {
      const parts = TOKEN.split(".");
      const tampered = `wrong-id.${parts[1]}.${parts[2]}.${parts[3]}`;
      expect(() =>
        verifyShareLink({ token: tampered, secret: SECRET, nowMs: EXPIRES_AT - 1 }),
      ).toThrow(InvalidShareLinkError);
    });

    it("throws InvalidShareLinkError on tampered tenantId segment (cross-tenant attack)", () => {
      const parts = TOKEN.split(".");
      const tampered = `${parts[0]}.attacker-tenant.${parts[2]}.${parts[3]}`;
      expect(() =>
        verifyShareLink({ token: tampered, secret: SECRET, nowMs: EXPIRES_AT - 1 }),
      ).toThrow(InvalidShareLinkError);
    });

    it("throws InvalidShareLinkError on tampered expiresAt segment", () => {
      const parts = TOKEN.split(".");
      const tampered = `${parts[0]}.${parts[1]}.99999999999999.${parts[3]}`;
      expect(() =>
        verifyShareLink({ token: tampered, secret: SECRET, nowMs: EXPIRES_AT - 1 }),
      ).toThrow(InvalidShareLinkError);
    });

    it("rejects malformed tokens (wrong segment count, empty segments, non-numeric expiry)", () => {
      const cases = [
        "only-one",
        "two.segments",
        "three.segments.only",
        "a.b.c.d.e",
        "...",
        "id..100.sig",
        "id.tenant..sig",
        "id.tenant.notnumeric.sig",
      ];
      for (const t of cases) {
        expect(() => verifyShareLink({ token: t, secret: SECRET, nowMs: 1 })).toThrow(
          InvalidShareLinkError,
        );
      }
    });
  });
});
