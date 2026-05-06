/**
 * Hub password lifecycle planner (pure function).
 *
 * Determines what to do with the Hub password on each boot or reset:
 *
 *   - "generate" — generate a new 24-char base32 password, argon2-hash
 *     it, store the hash, and log the plaintext ONCE. Happens when:
 *       • No hash exists yet (first boot in non-local stage).
 *       • `resetMode=true` (CLI `hub:reset-password`).
 *
 *   - "verify-only" — hash already exists; only read it for login
 *     verification. Never log the plaintext. Happens on subsequent
 *     boots in non-local stages.
 *
 *   - "skip" — local stage; Hub is unauthenticated. No hash needed.
 *
 * The planner is I/O-free — the caller (HubPasswordService) handles
 * DB reads/writes and argon2 hashing. Keeping the decision logic pure
 * makes it trivially testable without spinning up Postgres.
 */

import type { HubStage } from "./hub-auth-planner.js";

export type HubPasswordAction = "generate" | "verify-only" | "skip";

export interface HubPasswordPlanGenerate {
  action: "generate";
  logPlaintext: true;
  passwordLength: 24;
  alphabet: "base32";
}

export interface HubPasswordPlanVerifyOnly {
  action: "verify-only";
  logPlaintext: false;
}

export interface HubPasswordPlanSkip {
  action: "skip";
  logPlaintext: false;
}

export type HubPasswordPlan =
  | HubPasswordPlanGenerate
  | HubPasswordPlanVerifyOnly
  | HubPasswordPlanSkip;

export interface HubPasswordInput {
  /** Existing argon2 hash from `system_secrets`, or null if not yet set. */
  existingHash: string | null;
  /** Deployment stage — determines whether auth is in use at all. */
  stage: HubStage;
  /**
   * When true, always generates a new password (CLI reset command).
   * Ignores `existingHash`.
   */
  resetMode?: boolean;
}

/**
 * Decide the Hub password lifecycle action for the current boot.
 *
 * Local stage always returns "skip" — password is irrelevant because
 * `buildHubAuthConfig` returns `requireAuth=false` for local.
 */
export function buildHubPasswordPlan(input: HubPasswordInput): HubPasswordPlan {
  // Local stage: Hub is unauthenticated, no password needed.
  if (input.stage === "local") {
    return { action: "skip", logPlaintext: false };
  }

  // Reset mode OR first boot: generate a new password.
  if (input.resetMode || input.existingHash === null) {
    return {
      action: "generate",
      logPlaintext: true,
      passwordLength: 24,
      alphabet: "base32",
    };
  }

  // Hash exists and not a reset: only verify, never log.
  return { action: "verify-only", logPlaintext: false };
}
