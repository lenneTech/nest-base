import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GdprErasureRunner } from "../../src/core/gdpr/gdpr-erasure.runner.js";
import { PrismaService } from "../../src/core/prisma/prisma.service.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

const TENANT_ID = "00000000-0000-0000-0000-0000000000c1";
const USER_PAST_GRACE = "00000000-0000-0000-0000-0000000000c2";
const USER_IN_GRACE = "00000000-0000-0000-0000-0000000000c3";

const THIRTY_FIVE_DAYS_MS = 35 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Story · default GdprErasureRunner reads pending_erasure rows +
 * anonymises Users past their 30-day grace window + watermarks the
 * row's `completed_at` (CF.GDPR.04 — Finding 4 from iter-84 reviewer).
 *
 * Iter-75 wired the runner with a no-op default
 * (`readPending: () => []`, `eraseUser: noop`,
 * `markCompleted: noop`) — so the daily cron tick never erased
 * anyone. Iter-88 fixes the audit-finding by binding the production
 * factory: real Prisma reads from a new `pending_erasures` table,
 * a real anonymise-User implementation, and a real
 * `completed_at` watermark write.
 */
describe("Story · default GdprErasureRunner reads + anonymises + watermarks", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let runner: GdprErasureRunner;

  beforeAll(async () => {
    const { bootstrap } = await import("../../src/core/app/bootstrap.js");
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);
    runner = app.get(GdprErasureRunner);

    // Seed: a Tenant + two Users — one past grace, one inside grace.
    await prisma.tenant.upsert({
      where: { id: TENANT_ID },
      update: {},
      create: { id: TENANT_ID, name: `gdpr-erasure-fixture-${Date.now()}` },
    });
    await prisma.user.upsert({
      where: { id: USER_PAST_GRACE },
      update: {},
      create: {
        id: USER_PAST_GRACE,
        email: `past-grace-${Date.now()}@test.com`,
        name: "Past Grace",
        tenantId: TENANT_ID,
      },
    });
    await prisma.user.upsert({
      where: { id: USER_IN_GRACE },
      update: {},
      create: {
        id: USER_IN_GRACE,
        email: `in-grace-${Date.now()}@test.com`,
        name: "In Grace",
        tenantId: TENANT_ID,
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM pending_erasures WHERE user_id IN ($1::uuid, $2::uuid)`,
        USER_PAST_GRACE,
        USER_IN_GRACE,
      );
      await prisma.user
        .deleteMany({ where: { id: { in: [USER_PAST_GRACE, USER_IN_GRACE] } } })
        .catch(() => undefined);
      await prisma.tenant.delete({ where: { id: TENANT_ID } }).catch(() => undefined);
    }
    if (app) await app.close();
  });

  it("tick() anonymises a user whose pending_erasure is past 30 days, watermarks completed_at", async () => {
    const pastGraceRequest = new Date(Date.now() - THIRTY_FIVE_DAYS_MS);

    // Seed a pending_erasure row for USER_PAST_GRACE (35 days old → ready).
    await prisma.$executeRawUnsafe(
      `INSERT INTO pending_erasures (id, user_id, requested_at, cancelled_at, completed_at)
       VALUES (gen_random_uuid(), $1::uuid, $2::timestamp, NULL, NULL)`,
      USER_PAST_GRACE,
      pastGraceRequest.toISOString(),
    );
    // Seed a pending_erasure row for USER_IN_GRACE (1 day old → still in grace).
    const inGraceRequest = new Date(Date.now() - ONE_DAY_MS);
    await prisma.$executeRawUnsafe(
      `INSERT INTO pending_erasures (id, user_id, requested_at, cancelled_at, completed_at)
       VALUES (gen_random_uuid(), $1::uuid, $2::timestamp, NULL, NULL)`,
      USER_IN_GRACE,
      inGraceRequest.toISOString(),
    );

    const result = await runner.tick();
    expect(result.erased).toBe(1);
    expect(result.stillInGrace).toBe(1);

    // The past-grace user is anonymised: email replaced with a sentinel
    // `[ERASED]@erased.local`-style value, name set to "[ERASED]".
    const erasedUser = await prisma.user.findUnique({ where: { id: USER_PAST_GRACE } });
    expect(erasedUser).not.toBeNull();
    expect(erasedUser?.email).toMatch(/^\[ERASED\]/);
    expect(erasedUser?.name).toBe("[ERASED]");

    // The in-grace user is untouched — no anonymisation yet.
    const inGraceUser = await prisma.user.findUnique({ where: { id: USER_IN_GRACE } });
    expect(inGraceUser?.email).not.toMatch(/^\[ERASED\]/);
    expect(inGraceUser?.name).toBe("In Grace");

    // The pending_erasure row for the past-grace user has its
    // `completed_at` watermark set; the in-grace row's stays NULL.
    const watermarks = (await prisma.$queryRawUnsafe(
      `SELECT user_id, completed_at FROM pending_erasures
        WHERE user_id IN ($1::uuid, $2::uuid)`,
      USER_PAST_GRACE,
      USER_IN_GRACE,
    )) as Array<{ user_id: string; completed_at: Date | null }>;

    const pastGraceWatermark = watermarks.find((w) => w.user_id === USER_PAST_GRACE);
    expect(pastGraceWatermark?.completed_at).not.toBeNull();
    const inGraceWatermark = watermarks.find((w) => w.user_id === USER_IN_GRACE);
    expect(inGraceWatermark?.completed_at).toBeNull();

    // Second tick: erased=0 (already completed), stillInGrace=1.
    const second = await runner.tick();
    expect(second.erased).toBe(0);
    expect(second.stillInGrace).toBe(1);
  });
});
