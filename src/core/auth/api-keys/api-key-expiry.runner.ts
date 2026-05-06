import { Injectable, Logger } from "@nestjs/common";

import { ScheduledJob } from "../../jobs/scheduled-job.decorator.js";
import {
  type ApiKeyExpiryRecord,
  type ExpiryNotification,
  planExpiryNotifications,
} from "./api-key-expiry.notifier.js";

/**
 * `ApiKeyExpiryRunner` — daily cron that walks active API keys and
 * fires "your key expires in N days" notifications via the planner
 * (`planExpiryNotifications`).
 *
 * The runner takes its inputs through closure injection rather than
 * direct dependencies on `ApiKeyService` / `EmailService` so the
 * scheduled-job harness can test the cron tick without spinning up
 * the full app. The Module registers a concrete factory that
 * provides a real reader + sender at boot.
 *
 * Default schedule:
 *   - cron: "0 8 * * *"  (08:00 UTC every day)
 *   - warnWithinMs: 7 days
 *   - notifyCooldownMs: 1 day
 *
 * Closes:
 *   - CF.AUTH.17 (API key expiry notifier — scheduled job binding)
 */
export interface ApiKeyExpiryRunnerInput {
  /** Returns every API key's id + userId + expiresAt + lastNotifiedAt. */
  readKeys: () => Promise<readonly ApiKeyExpiryRecord[]>;
  /** Sends a single expiry notification. Implementer routes via EmailService. */
  sendNotification: (notification: ExpiryNotification) => Promise<void>;
  /**
   * Persists the `lastNotifiedAt` watermark on a key after a successful
   * notification. The pg-boss tick is idempotent — re-running the same
   * tick must not double-notify.
   */
  markNotified: (keyId: string, atMs: number) => Promise<void>;
  /** Override warn-window. Default 7 days. */
  warnWithinMs?: number;
  /** Override re-notify cooldown. Default 1 day. */
  notifyCooldownMs?: number;
  /** Injectable clock for deterministic tests. */
  clock?: () => number;
}

const DEFAULT_WARN_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DAILY_CRON = "0 8 * * *";

@Injectable()
export class ApiKeyExpiryRunner {
  private readonly log = new Logger("ApiKeyExpiryRunner");

  constructor(private readonly input: ApiKeyExpiryRunnerInput) {}

  /**
   * Daily tick — pg-boss adapter wires this to the `apiKeyExpiry`
   * queue at module init via the `@ScheduledJob` metadata.
   */
  @ScheduledJob({ name: "apiKeyExpiry", cron: DAILY_CRON })
  async tick(): Promise<{ notified: number }> {
    const keys = await this.input.readKeys();
    const plan = planExpiryNotifications({
      keys,
      warnWithinMs: this.input.warnWithinMs ?? DEFAULT_WARN_WITHIN_MS,
      notifyCooldownMs: this.input.notifyCooldownMs ?? DEFAULT_COOLDOWN_MS,
      ...(this.input.clock ? { clock: this.input.clock } : {}),
    });
    const now = (this.input.clock ?? Date.now)();
    let notified = 0;
    for (const notification of plan.notifications) {
      try {
        await this.input.sendNotification(notification);
        await this.input.markNotified(notification.keyId, now);
        notified++;
      } catch (err) {
        // Per-notification failure is non-fatal — the next tick re-evaluates
        // because the `lastNotifiedAt` watermark stays unchanged on failure.
        this.log.error(
          `apiKeyExpiry: failed to notify keyId=${notification.keyId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    if (notified > 0) {
      this.log.log(`apiKeyExpiry: sent ${notified} expiry notification(s)`);
    }
    return { notified };
  }
}
