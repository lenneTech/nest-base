import { Global, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { EMAIL_OUTBOX_STORAGE } from "../../src/core/email/email-outbox.module.js";
import { HealthModule } from "../../src/core/health/health.module.js";
import { HealthService } from "../../src/core/health/health.service.js";
import { PrismaService } from "../../src/core/prisma/prisma.service.js";

/**
 * Story · HealthService standalone bootstrap (friction-log #3).
 *
 * The TDD workflow this project mandates relies on `bun run test:e2e
 * tests/<one-file>.e2e-spec.ts` working in isolation. When five+
 * AppModule-importing specs hit
 * `Nest can't resolve dependencies of the HealthService (?,
 * Symbol(lt:EmailOutboxStorage))` the iteration loop is broken — the
 * red→green→refactor cycle becomes 30 s vs 6 min.
 *
 * Root cause: HealthService injects `@Optional() @Inject(EMAIL_OUTBOX_STORAGE)`,
 * but Nest still requires the token to be reachable somewhere in the
 * resolution graph. When a TestingModule imports `HealthModule`
 * without `EmailOutboxModule` (which is what minimal specs do),
 * resolution fails before the `@Optional()` fallback kicks in.
 *
 * The fix must keep the production wiring untouched: when
 * `EmailOutboxModule` is loaded (via `AppModule`), HealthService
 * MUST still see the real `EmailOutboxStorage` so the readiness probe
 * reports outbox lag. When the module isn't loaded, HealthService
 * MUST construct cleanly and report `emailOutbox: undefined`.
 */
describe("Story · HealthService standalone bootstrap", () => {
  it("constructs cleanly when no EMAIL_OUTBOX_STORAGE provider exists in scope", async () => {
    const fakePrisma = { $queryRaw: async () => [{ "?column?": 1 }] };

    @Global()
    @Module({
      providers: [{ provide: PrismaService, useValue: fakePrisma }],
      exports: [PrismaService],
    })
    class FakeGlobalPrismaModule {}

    // Build a TestingModule the way TDD-friction friction-log #3
    // describes: HealthModule imported without EmailOutboxModule. This
    // is the shape five+ AppModule-importing e2e specs end up with
    // when they boot in isolation, and what every story test for
    // HealthService consumers needs to be able to do.
    const moduleRef = await Test.createTestingModule({
      imports: [FakeGlobalPrismaModule, HealthModule],
    }).compile();

    const svc = moduleRef.get(HealthService);
    expect(svc).toBeDefined();
    // The readiness probe must NOT include emailOutbox when the
    // outbox module isn't wired — otherwise the LB drains the instance
    // for a checker that never had a chance to report ok.
    const report = await svc.readiness();
    expect(report.checks.emailOutbox).toBeUndefined();

    await moduleRef.close();
  });

  it("picks up the real EMAIL_OUTBOX_STORAGE when a @Global() provider exists", async () => {
    const fakePrisma = { $queryRaw: async () => [{ "?column?": 1 }] };
    const realStorage = {
      async countPending() {
        return 0;
      },
      async oldestPendingAge() {
        return 0;
      },
    };

    @Global()
    @Module({
      providers: [{ provide: PrismaService, useValue: fakePrisma }],
      exports: [PrismaService],
    })
    class FakeGlobalPrismaModule {}

    @Global()
    @Module({
      providers: [{ provide: EMAIL_OUTBOX_STORAGE, useValue: realStorage }],
      exports: [EMAIL_OUTBOX_STORAGE],
    })
    class FakeGlobalEmailOutboxModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [FakeGlobalPrismaModule, FakeGlobalEmailOutboxModule, HealthModule],
    }).compile();

    const svc = moduleRef.get(HealthService);
    const report = await svc.readiness();
    // Real outbox is wired — readiness must surface its check.
    expect(report.checks.emailOutbox).toBeDefined();
    expect(report.checks.emailOutbox?.status).toBe("ok");

    await moduleRef.close();
  });
});
