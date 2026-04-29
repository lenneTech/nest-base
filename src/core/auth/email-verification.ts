import { randomBytes } from "node:crypto";

/**
 * Email-verification token + link helpers.
 *
 * Token: 32 random bytes hex-encoded → 64 hex chars / 256 bits of
 * entropy. Stored hashed in Postgres so leaks of the DB don't yield
 * usable verification tokens.
 *
 * Link: `${baseUrl}/api/auth/verify-email?token=<token>`. The mount
 * path is the Better-Auth default; consumers can override per project.
 */

export function generateVerificationToken(): string {
  return randomBytes(32).toString("hex");
}

export interface VerificationLinkInput {
  baseUrl: string;
  token: string;
  mountPath?: string;
}

export function verificationLinkUrl(input: VerificationLinkInput): string {
  const mountPath = input.mountPath ?? "/api/auth";
  // throws on invalid baseUrl — that is the contract
  const url = new URL(`${mountPath}/verify-email`, input.baseUrl);
  url.searchParams.set("token", input.token);
  return url.toString();
}

export interface VerificationExpiryInput {
  issuedAt: Date;
  ttlSeconds: number;
}

export function isVerificationTokenExpired(input: VerificationExpiryInput): boolean {
  const ageMs = Date.now() - input.issuedAt.getTime();
  return ageMs > input.ttlSeconds * 1_000;
}
