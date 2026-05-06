import { Injectable, OnApplicationBootstrap } from "@nestjs/common";
import { hash, verify } from "@node-rs/argon2";

import { PrismaService } from "../prisma/prisma.service.js";
import { serverConfigFromEnv } from "../server/server-config.js";
import { buildHubPasswordPlan } from "./hub-password-planner.js";
import type { HubStage } from "./hub-auth-planner.js";

/**
 * Key used in `system_secrets` to store the Hub password hash.
 *
 * Exported so the CLI reset command and tests can reference it without
 * duplicating the literal string.
 */
export const HUB_PASSWORD_SECRET_KEY = "hub_password_hash";

/**
 * Maps the NestJS `AppEnv` values to the `HubStage` taxonomy.
 *
 * NestJS knows "development" / "staging" / "production". The Hub
 * planner additionally has "local" (developer machine, no auth) and
 * "test" (CI, auth required). We treat "development" as "local" so
 * developers never see a login page when running locally.
 */
function appEnvToHubStage(env: string): HubStage {
  if (env === "development") return "local";
  if (env === "production") return "production";
  if (env === "test") return "test";
  // staging and any other non-local value default to "staging".
  return "staging";
}

/**
 * Generates a random 24-character base32 password.
 *
 * Base32 alphabet (RFC 4648): A–Z + 2–7. Avoids ambiguous characters
 * (0/O, 1/I/L) so operators can transcribe the password from a terminal
 * without character-confusion errors.
 */
function generateBase32Password(length: 24): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]!).join("");
}

/**
 * HubPasswordService — manages the Hub password lifecycle.
 *
 * On `OnApplicationBootstrap`:
 *   - Local stage: no-op (Hub is unauthenticated).
 *   - Non-local, no hash exists: generate 24-char base32 password,
 *     argon2-hash it, upsert into `system_secrets`, log plaintext
 *     exactly once with a "store this now" notice.
 *   - Non-local, hash exists: read hash, never log.
 *
 * `verifyPassword(candidate)` returns `true` when the candidate
 * matches the stored argon2 hash.
 */
@Injectable()
export class HubPasswordService implements OnApplicationBootstrap {
  private passwordHash: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const cfg = serverConfigFromEnv(process.env);
    const stage = appEnvToHubStage(cfg.env);

    const existing = await this.prisma.systemSecret
      .findUnique({ where: { key: HUB_PASSWORD_SECRET_KEY } })
      .catch(() => null);

    const plan = buildHubPasswordPlan({
      existingHash: existing?.value ?? null,
      stage,
    });

    if (plan.action === "skip") {
      // Local stage — Hub requires no auth.
      return;
    }

    if (plan.action === "verify-only") {
      // Hash already set; cache it for login checks.
      this.passwordHash = existing!.value;
      return;
    }

    // action === "generate": first boot or explicit reset.
    const plaintext = generateBase32Password(24);
    const hashed = await hash(plaintext);

    await this.prisma.systemSecret.upsert({
      where: { key: HUB_PASSWORD_SECRET_KEY },
      update: { value: hashed },
      create: { key: HUB_PASSWORD_SECRET_KEY, value: hashed },
    });

    this.passwordHash = hashed;

    // Print the plaintext ONCE. The notice is intentionally loud —
    // operators must record it before the process restarts, at which
    // point only the hash remains and the plaintext is gone forever.
    process.stdout.write(`
╔══════════════════════════════════════════════════════════════════╗
║                    HUB PASSWORD GENERATED                        ║
║                                                                  ║
║  STORE THIS NOW — it will never be shown again.                  ║
║                                                                  ║
║  Password: ${plaintext.padEnd(53)}║
║                                                                  ║
║  Use it to log in to the Hub UI at /                             ║
║  To reset: bun run hub:reset-password                            ║
╚══════════════════════════════════════════════════════════════════╝
`);
  }

  /**
   * Verify a candidate password against the stored argon2 hash.
   *
   * Returns `false` if no hash has been loaded (e.g. local stage or
   * bootstrap hasn't run yet — both are safe denials).
   */
  async verifyPassword(candidate: string): Promise<boolean> {
    if (!this.passwordHash) return false;
    try {
      return await verify(this.passwordHash, candidate);
    } catch {
      return false;
    }
  }

  /**
   * Replace the stored password hash (used by CLI reset command and
   * during bootstrap in generate mode).
   *
   * Called directly from `hub:reset-password` script — not part of the
   * NestJS request/response cycle.
   */
  async resetPassword(): Promise<string> {
    const plaintext = generateBase32Password(24);
    const hashed = await hash(plaintext);

    await this.prisma.systemSecret.upsert({
      where: { key: HUB_PASSWORD_SECRET_KEY },
      update: { value: hashed },
      create: { key: HUB_PASSWORD_SECRET_KEY, value: hashed },
    });

    this.passwordHash = hashed;
    return plaintext;
  }
}
