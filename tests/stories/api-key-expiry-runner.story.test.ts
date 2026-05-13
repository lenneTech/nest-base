import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ApiKeyExpiryRunner } from "../../src/core/auth/api-keys/api-key-expiry.runner.js";
import { getScheduledJobs } from "../../src/core/jobs/scheduled-job.decorator.js";

/**
 * Story · API key expiry runner (CF.AUTH.17).
 *
 * The PRD requires the API-key expiry notifier (planner) to be wired
 * to a runtime cron — `tests/stories/api-key-expiry-notifier.story.test.ts`
 * already covers the planner; this slice covers the runner that
 * binds the planner to a scheduled-job cron and sends notifications.
 *
 * The runner is closure-injected with `readKeys` / `sendNotification`
 * / `markNotified` callbacks so the tick is testable without
 * Postgres + EmailService. The `@ScheduledJob` metadata on `tick()`
 * surfaces in the DiscoveryService walk the pg-boss adapter
 * performs at OnApplicationBootstrap.
 */
const ROOT = resolve(__dirname, "..", "..");

describe("Story · ApiKeyExpiryRunner", () => {
  it("registers the @ScheduledJob metadata with name=apiKeyExpiry + daily cron", () => {
    const meta = getScheduledJobs(ApiKeyExpiryRunner.prototype);
    expect(meta).toHaveLength(1);
    expect(meta[0]?.name).toBe("apiKeyExpiry");
    expect(meta[0]?.cron).toBe("0 8 * * *");
    expect(meta[0]?.methodName).toBe("tick");
  });

  it("emits zero notifications when no keys are within the warn window", async () => {
    const sent: number[] = [];
    const runner = new ApiKeyExpiryRunner({
      readKeys: async () => [
        { id: "k1", userId: "u1", expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000 },
      ],
      sendNotification: async () => {
        sent.push(1);
      },
      markNotified: async () => {},
    });
    const result = await runner.tick();
    expect(result.notified).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("emits one notification for a key inside the warn window", async () => {
    const now = Date.now();
    const sent: Array<{ keyId: string; expiresAt: number }> = [];
    const watermarks: Array<{ keyId: string; atMs: number }> = [];
    const runner = new ApiKeyExpiryRunner({
      readKeys: async () => [
        {
          id: "k1",
          userId: "u1",
          expiresAt: now + 3 * 24 * 60 * 60 * 1000, // 3 days from now
          lastNotifiedAt: null,
        },
      ],
      sendNotification: async (n) => {
        sent.push({ keyId: n.keyId, expiresAt: n.expiresAt });
      },
      markNotified: async (id, atMs) => {
        watermarks.push({ keyId: id, atMs });
      },
      clock: () => now,
    });
    const result = await runner.tick();
    expect(result.notified).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.keyId).toBe("k1");
    expect(watermarks).toHaveLength(1);
    expect(watermarks[0]?.keyId).toBe("k1");
  });

  it("isolates a sendNotification failure (logged, watermark not advanced, tick continues)", async () => {
    const now = Date.now();
    const watermarks: string[] = [];
    let sendCalls = 0;
    const runner = new ApiKeyExpiryRunner({
      readKeys: async () => [
        { id: "k1", userId: "u1", expiresAt: now + 1 * 24 * 60 * 60 * 1000 },
        { id: "k2", userId: "u2", expiresAt: now + 2 * 24 * 60 * 60 * 1000 },
      ],
      sendNotification: async (n) => {
        sendCalls++;
        if (n.keyId === "k1") throw new Error("smtp down");
      },
      markNotified: async (id) => {
        watermarks.push(id);
      },
      clock: () => now,
    });
    const result = await runner.tick();
    // k1 throws → no watermark advance for it; k2 succeeds.
    expect(sendCalls).toBe(2);
    expect(result.notified).toBe(1);
    expect(watermarks).toEqual(["k2"]);
  });

  describe("ApiKeyModule registration", () => {
    it("registers ApiKeyExpiryRunner as a NestJS provider so DiscoveryService picks it up", () => {
      const moduleSrc = readFileSync(
        resolve(ROOT, "src/core/auth/api-keys/api-key.module.ts"),
        "utf8",
      );
      expect(moduleSrc).toContain("ApiKeyExpiryRunner");
      expect(moduleSrc).toContain("api-key-expiry.runner.js");
      expect(moduleSrc).toMatch(/provide:\s*ApiKeyExpiryRunner/);
      expect(moduleSrc).toMatch(/exports:.*ApiKeyExpiryRunner/s);
    });

    it("the default factory routes through buildDefaultApiKeyExpiryRunnerInput (Prisma + EmailService)", () => {
      const moduleSrc = readFileSync(
        resolve(ROOT, "src/core/auth/api-keys/api-key.module.ts"),
        "utf8",
      );
      // Iter-87 closed Finding 5: the default factory binds to real
      // Prisma reads + EmailService dispatch + last_notified_at
      // watermark. The dedicated factory file
      // (`api-key-expiry.factory.ts`) holds the implementation; the
      // module's job is to wire it under DI with Prisma + EmailService
      // injected.
      expect(moduleSrc).toContain("buildDefaultApiKeyExpiryRunnerInput");
      expect(moduleSrc).toContain('from "./api-key-expiry.factory.js"');
      // ConfigService was added to the inject array in Fix #16 so the factory
      // can read server.baseUrl instead of accessing process.env directly.
      expect(moduleSrc).toMatch(
        /inject:\s*\[\s*PrismaService,\s*EmailService,\s*ConfigService\s*\]/,
      );
    });

    it("the default factory file reads expiring keys via Prisma + dispatches via EmailService", () => {
      const factorySrc = readFileSync(
        resolve(ROOT, "src/core/auth/api-keys/api-key-expiry.factory.ts"),
        "utf8",
      );
      expect(factorySrc).toContain("$queryRawUnsafe");
      expect(factorySrc).toContain("FROM api_keys");
      expect(factorySrc).toContain("expires_at IS NOT NULL");
      expect(factorySrc).toContain('template: "api-key-expiring"');
      expect(factorySrc).toContain("last_notified_at");
    });
  });
});
