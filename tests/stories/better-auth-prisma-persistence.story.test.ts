import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");
const SCHEMA = readFileSync(resolve(ROOT, "prisma/schema.prisma"), "utf8");

/**
 * Story · Better-Auth → Prisma persistence (schema)
 *
 * Replaces the previous in-memory storage. The Better-Auth Prisma
 * adapter (`better-auth/adapters/prisma`) maps Better-Auth's logical
 * "user / session / account / verification" tables to the Prisma
 * models declared in `prisma/schema.prisma`.
 *
 * Per the project rule "Reuse Better-Auth's user. Don't shadow it",
 * Better-Auth owns the `User` Prisma model. Our existing tenant /
 * api-key / membership tables continue to FK against `users` — this
 * story locks down the additive shape required by the adapter:
 *   - `User` gets `name` / `emailVerified` / `image` columns
 *   - `User.tenantId` becomes nullable so Better-Auth's sign-up flow
 *     works without forcing the caller to pre-pick a tenant
 *   - new models for `Session`, `Account`, `Verification` (core), plus
 *     `Jwks` (jwt plugin), `TwoFactor` (twoFactor plugin), and
 *     `Passkey` (passkey plugin) — all opt-in but always present in
 *     the schema so a single `prisma migrate deploy` covers every
 *     authMethods toggle.
 */
describe("Story · Better-Auth Prisma persistence (schema)", () => {
  function blockOf(model: string): string {
    const re = new RegExp(`model\\s+${model}\\s*\\{[\\s\\S]*?\\n\\}`, "m");
    const match = SCHEMA.match(re);
    expect(match, `model ${model} block not found`).not.toBeNull();
    return match![0];
  }

  describe("User model — Better-Auth required fields", () => {
    it("declares a `name` column (required by Better-Auth's user)", () => {
      expect(blockOf("User")).toMatch(/^\s*name\s+String/m);
    });

    it("declares an `emailVerified` boolean mapped to email_verified", () => {
      const b = blockOf("User");
      expect(b).toMatch(/emailVerified\s+Boolean/);
      expect(b).toMatch(/emailVerified[\s\S]*@map\(\s*"email_verified"\s*\)/);
    });

    it("declares an optional `image` column", () => {
      expect(blockOf("User")).toMatch(/^\s*image\s+String\?/m);
    });

    it("makes tenantId optional so Better-Auth signups can create a user without a tenant pre-pick", () => {
      const b = blockOf("User");
      // Either `tenantId String?` (canonical) or a `?` after the @db.Uuid attribute is
      // present. The strict shape we expect is `String? @map(...) @db.Uuid`.
      expect(b).toMatch(/tenantId\s+String\?/);
    });
  });

  describe("Session model", () => {
    const block = (): string => blockOf("Session");

    it("exists and maps to the `sessions` table", () => {
      expect(block()).toMatch(/@@map\(\s*"sessions"\s*\)/);
    });

    it("has the four canonical Better-Auth columns: token, expiresAt, ipAddress, userAgent", () => {
      const b = block();
      expect(b).toMatch(/token\s+String\s+@unique/);
      expect(b).toMatch(/expiresAt[\s\S]*@map\(\s*"expires_at"\s*\)/);
      expect(b).toMatch(/ipAddress[\s\S]*@map\(\s*"ip_address"\s*\)/);
      expect(b).toMatch(/userAgent[\s\S]*@map\(\s*"user_agent"\s*\)/);
    });

    it("FKs userId → User.id with cascade delete", () => {
      const b = block();
      expect(b).toMatch(/userId\s+String/);
      expect(b).toMatch(/onDelete:\s*Cascade/);
    });
  });

  describe("Account model (OAuth + email-password credentials)", () => {
    const block = (): string => blockOf("Account");

    it("exists and maps to the `accounts` table", () => {
      expect(block()).toMatch(/@@map\(\s*"accounts"\s*\)/);
    });

    it("declares accountId, providerId, password (hashed), and the OAuth tokens", () => {
      const b = block();
      expect(b).toMatch(/accountId[\s\S]*@map\(\s*"account_id"\s*\)/);
      expect(b).toMatch(/providerId[\s\S]*@map\(\s*"provider_id"\s*\)/);
      // Better-Auth stores the argon2 hash under `password`. Optional —
      // OAuth-only accounts have no password column populated.
      expect(b).toMatch(/^\s*password\s+String\?/m);
      expect(b).toMatch(/accessToken[\s\S]*@map\(\s*"access_token"\s*\)/);
      expect(b).toMatch(/refreshToken[\s\S]*@map\(\s*"refresh_token"\s*\)/);
    });
  });

  describe("Verification model (email + password reset tokens)", () => {
    const block = (): string => blockOf("Verification");

    it("exists and maps to the `verifications` table", () => {
      expect(block()).toMatch(/@@map\(\s*"verifications"\s*\)/);
    });

    it("declares identifier, value, expiresAt", () => {
      const b = block();
      expect(b).toMatch(/^\s*identifier\s+String/m);
      expect(b).toMatch(/^\s*value\s+String/m);
      expect(b).toMatch(/expiresAt[\s\S]*@map\(\s*"expires_at"\s*\)/);
    });
  });

  describe("Plugin tables", () => {
    it("declares a Jwks model mapped to `jwks` (jwt plugin)", () => {
      const b = blockOf("Jwks");
      expect(b).toMatch(/@@map\(\s*"jwks"\s*\)/);
      expect(b).toMatch(/publicKey[\s\S]*@map\(\s*"public_key"\s*\)/);
      expect(b).toMatch(/privateKey[\s\S]*@map\(\s*"private_key"\s*\)/);
    });

    it("declares a TwoFactor model mapped to `two_factors` (twoFactor plugin)", () => {
      const b = blockOf("TwoFactor");
      expect(b).toMatch(/@@map\(\s*"two_factors"\s*\)/);
      expect(b).toMatch(/^\s*secret\s+String/m);
      expect(b).toMatch(/backupCodes[\s\S]*@map\(\s*"backup_codes"\s*\)/);
    });

    it("declares a Passkey model mapped to `passkeys` (passkey plugin)", () => {
      const b = blockOf("Passkey");
      expect(b).toMatch(/@@map\(\s*"passkeys"\s*\)/);
      expect(b).toMatch(/credentialID[\s\S]*@map\(\s*"credential_id"\s*\)/);
      expect(b).toMatch(/^\s*publicKey/m);
      expect(b).toMatch(/^\s*counter\s+Int/m);
    });

    it("Passkey, TwoFactor, Session, Account all FK userId to User with cascade", () => {
      for (const model of ["Passkey", "TwoFactor", "Session", "Account"]) {
        const b = blockOf(model);
        expect(b, `${model} should reference User`).toMatch(
          /user\s+User\s+@relation\([^)]*onDelete:\s*Cascade/,
        );
      }
    });
  });
});
