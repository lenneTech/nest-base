import { describe, expect, it } from "vitest";

import {
  CookieConfigSchema,
  CorsConfigSchema,
  cookieDefaults,
  corsDefaults,
} from "../src/core/http/cookie-cors-config.js";

/**
 * Adapted from nest-server `cookies-cors-config.spec.ts`.
 * Validates the config schemas only — actual middleware wiring lands when
 * the NestJS app boots (Phase 1 / Helmet + CSP / Phase 2 / auth-cookie).
 */
describe("Cookie & CORS Config", () => {
  describe("CookieConfigSchema", () => {
    it("accepts a complete production-grade cookie config", () => {
      const parsed = CookieConfigSchema.safeParse({
        name: "nst_session",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        domain: "api.example.com",
        maxAgeSeconds: 60 * 60 * 24,
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects sameSite values outside the RFC-allowed set", () => {
      const parsed = CookieConfigSchema.safeParse({
        name: "x",
        httpOnly: true,
        secure: true,
        sameSite: "sometimes",
        path: "/",
        maxAgeSeconds: 1,
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects empty cookie names", () => {
      const parsed = CookieConfigSchema.safeParse({
        name: "",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAgeSeconds: 1,
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("CorsConfigSchema", () => {
    it("accepts an explicit origin allowlist", () => {
      const parsed = CorsConfigSchema.safeParse({
        allowedOrigins: ["https://app.example.com"],
        credentials: true,
        maxAgeSeconds: 600,
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects an empty allowlist when credentials=true (would block all browsers)", () => {
      const parsed = CorsConfigSchema.safeParse({
        allowedOrigins: [],
        credentials: true,
        maxAgeSeconds: 600,
      });
      expect(parsed.success).toBe(false);
    });

    it("allows an empty allowlist when credentials=false (public API)", () => {
      const parsed = CorsConfigSchema.safeParse({
        allowedOrigins: [],
        credentials: false,
        maxAgeSeconds: 600,
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe("Defaults", () => {
    it('cookieDefaults("production") returns Secure + SameSite=Lax + HttpOnly', () => {
      const cfg = cookieDefaults("production");
      expect(cfg.httpOnly).toBe(true);
      expect(cfg.secure).toBe(true);
      expect(cfg.sameSite).toBe("lax");
    });

    it('cookieDefaults("development") drops Secure to allow http://localhost', () => {
      const cfg = cookieDefaults("development");
      expect(cfg.httpOnly).toBe(true);
      expect(cfg.secure).toBe(false);
    });

    it('corsDefaults("development") allows localhost origins', () => {
      const cfg = corsDefaults("development");
      expect(cfg.allowedOrigins.some((origin) => origin.includes("localhost"))).toBe(true);
    });

    it('corsDefaults("development") includes http://localhost:3001 (template frontend port)', () => {
      // The lt fullstack template's Nuxt frontend runs on :3001 by default
      // (see projects/app/nuxt.config.ts devServer.port). Without this entry
      // the freshly-scaffolded SPA cannot call its own API in the browser
      // due to CORS preflight failure.
      const cfg = corsDefaults("development");
      expect(cfg.allowedOrigins).toContain("http://localhost:3001");
    });

    it('corsDefaults("production") returns no origins (must be configured explicitly)', () => {
      const cfg = corsDefaults("production");
      expect(cfg.allowedOrigins).toEqual([]);
    });
  });
});
