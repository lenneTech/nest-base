/**
 * NIT-1: Single source of truth for the secret-field name blocklist.
 *
 * Imported by `remove-secrets.ts` (Stage 3), `safety-net.ts` (Stage 4),
 * and `output-pipeline.ts` (Stage 4 default list). All three stages
 * previously defined identical arrays inline; this constant eliminates
 * the redundancy and ensures they stay in sync.
 */
export const SECRET_FIELD_NAMES = [
  "password",
  "passwordHash",
  "token",
  "apiKey",
  "secret",
  "authToken",
  "refreshToken",
  "sessionToken",
  "pinHash",
  "mfaSecret",
] as const;
