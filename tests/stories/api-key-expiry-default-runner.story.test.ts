import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiKeyExpiryRunner } from "../../src/core/auth/api-keys/api-key-expiry.runner.js";
import { PrismaService } from "../../src/core/prisma/prisma.service.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

const TENANT_ID = "00000000-0000-0000-0000-0000000000aa";
const USER_ID = "00000000-0000-0000-0000-0000000000bb";

/**
 * Story · Default ApiKeyExpiryRunner reads expiring keys from
 * Prisma + dispatches via EmailService + persists `lastNotifiedAt`
 * watermark (CF.AUTH.17 — Finding 5 from iter-84 reviewer).
 *
 * Iter-74 wired the @ScheduledJob runner; iter-87 fixes the
 * audit-finding — the default factory's `readKeys: () => []`
 * meant the cron never found anything to notify. This story locks
 * the closed-loop behaviour: after seeding an ApiKey row that
 * expires in 3 days, calling `runner.tick()` writes a
 * `lastNotifiedAt` watermark to that row and a second tick within
 * the cooldown window does NOT re-notify.
 */
describe("Story · default ApiKeyExpiryRunner reads + notifies + watermarks", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let runner: ApiKeyExpiryRunner;
  const sentEmails: { to: string; template: string; vars: Record<string, unknown> }[] = [];

  beforeAll(async () => {
    const { bootstrap } = await import("../../src/core/app/bootstrap.js");
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);
    runner = app.get(ApiKeyExpiryRunner);

    // Spy on the EmailService so we don't need a real SMTP server.
    const { EmailService } = await import("../../src/core/email/email.service.js");
    const email = app.get(EmailService);
    const original = email.sendTemplate.bind(email);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (email as any).sendTemplate = async (
      opts: Parameters<typeof original>[0],
      dispatch?: Parameters<typeof original>[1],
    ) => {
      sentEmails.push({
        to: opts.to,
        template: opts.template,
        vars: (opts.vars ?? {}) as Record<string, unknown>,
      });
      return { id: "spy:email", payload: { dispatch } };
    };

    // Seed: a User in TENANT_ID + an ApiKey expiring in 3 days.
    await prisma.tenant.upsert({
      where: { id: TENANT_ID },
      update: {},
      create: { id: TENANT_ID, name: `api-key-expiry-fixture-${Date.now()}` },
    });
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: {
        id: USER_ID,
        email: `api-key-expiry-${Date.now()}@test.com`,
        name: "Expiry Test",
        tenantId: TENANT_ID,
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.apiKey.deleteMany({ where: { userId: USER_ID } });
      await prisma.user.delete({ where: { id: USER_ID } }).catch(() => undefined);
      await prisma.tenant.delete({ where: { id: TENANT_ID } }).catch(() => undefined);
    }
    if (app) await app.close();
  });

  it("tick() finds keys expiring within 7 days, sends an email, and watermarks `lastNotifiedAt`", async () => {
    sentEmails.length = 0;

    // Add a small forward bias (10 minutes) so the planner's
    // `Math.floor(msUntilExpiry / ONE_DAY_MS)` lands on the
    // expected 3-day bucket regardless of test scheduling jitter.
    const expiresInThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 + 10 * 60 * 1000);
    const apiKey = await prisma.apiKey.create({
      data: {
        lookupId: crypto.randomUUID(),
        hash: "fake-hash",
        name: "expiring-key",
        scopes: ["read:profile"],
        userId: USER_ID,
        expiresAt: expiresInThreeDays,
      },
    });

    const result = await runner.tick();
    expect(result.notified).toBe(1);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]?.template).toBe("api-key-expiring");
    expect(sentEmails[0]?.vars.daysUntilExpiry).toBe(3);

    const refreshed = await prisma.apiKey.findUnique({ where: { id: apiKey.id } });
    expect(refreshed?.lastNotifiedAt).not.toBeNull();
    const watermark = refreshed?.lastNotifiedAt;
    expect(watermark instanceof Date).toBe(true);

    // Second tick within the cooldown — must NOT re-notify.
    const second = await runner.tick();
    expect(second.notified).toBe(0);
    expect(sentEmails).toHaveLength(1);
  });

  it("tick() ignores keys without an expiry (no email, no watermark)", async () => {
    sentEmails.length = 0;
    const noExpiry = await prisma.apiKey.create({
      data: {
        lookupId: crypto.randomUUID(),
        hash: "fake-hash",
        name: "no-expiry-key",
        scopes: ["read:profile"],
        userId: USER_ID,
        expiresAt: null,
      },
    });

    const result = await runner.tick();
    expect(result.notified).toBe(0);
    expect(sentEmails).toHaveLength(0);

    const refreshed = await prisma.apiKey.findUnique({ where: { id: noExpiry.id } });
    expect(refreshed?.lastNotifiedAt).toBeNull();
  });

  it("tick() ignores keys expiring beyond the warn-window (>7 days)", async () => {
    sentEmails.length = 0;
    const expiresInTwentyDays = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    await prisma.apiKey.create({
      data: {
        lookupId: crypto.randomUUID(),
        hash: "fake-hash",
        name: "far-expiry-key",
        scopes: ["read:profile"],
        userId: USER_ID,
        expiresAt: expiresInTwentyDays,
      },
    });

    const result = await runner.tick();
    expect(result.notified).toBe(0);
    expect(sentEmails).toHaveLength(0);
  });
});
