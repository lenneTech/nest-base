import { Inject, Injectable, Optional } from "@nestjs/common";

import {
  classifyEmailOutboxLag,
  type EmailOutboxHealthResult,
} from "../email/email-outbox-health.js";
import { EMAIL_OUTBOX_STORAGE } from "../email/email-outbox.module.js";
import type { EmailOutboxStorage } from "../email/email-outbox.js";
import { PrismaService } from "../prisma/prisma.service.js";

export interface CheckResult {
  status: "ok" | "fail";
  responseTimeMs: number;
  error?: string;
}

export interface ReadinessReport {
  status: "ok" | "fail";
  checks: {
    database: CheckResult;
    /**
     * Present when the EmailOutboxModule is wired (always true in
     * production). The probe inspects pending count + oldest age and
     * flags `fail` if the worker is stalling — the load balancer
     * drains this instance so downstream Better-Auth verification
     * mails don't keep stacking up.
     */
    emailOutbox?: EmailOutboxHealthResult;
  };
}

/**
 * Aggregates readiness checks. Currently Postgres connectivity +
 * email-outbox lag (issue #11). Later slices add Redis/RustFS once
 * those land.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(EMAIL_OUTBOX_STORAGE) private readonly emailOutbox?: EmailOutboxStorage,
  ) {}

  async checkDatabase(): Promise<CheckResult> {
    const start = performance.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ok", responseTimeMs: Math.round(performance.now() - start) };
    } catch (error) {
      return {
        status: "fail",
        responseTimeMs: Math.round(performance.now() - start),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async checkEmailOutbox(): Promise<EmailOutboxHealthResult | undefined> {
    if (!this.emailOutbox) return undefined;
    try {
      const now = new Date();
      const [pendingCount, oldestAgeMs] = await Promise.all([
        this.emailOutbox.countPending(),
        this.emailOutbox.oldestPendingAge(now),
      ]);
      return classifyEmailOutboxLag({ pendingCount, oldestAgeMs });
    } catch (error) {
      // A storage error here surfaces as `fail` so the LB drains
      // the instance — better than reporting "ok" while the outbox
      // tests are silently broken.
      return {
        status: "fail",
        pendingCount: 0,
        lagMs: 0,
        thresholdMs: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async readiness(): Promise<ReadinessReport> {
    const [database, emailOutbox] = await Promise.all([
      this.checkDatabase(),
      this.checkEmailOutbox(),
    ]);
    const dbOk = database.status === "ok";
    const outboxOk = !emailOutbox || emailOutbox.status === "ok";
    const status: ReadinessReport["status"] = dbOk && outboxOk ? "ok" : "fail";
    const checks: ReadinessReport["checks"] = { database };
    if (emailOutbox) checks.emailOutbox = emailOutbox;
    return { status, checks };
  }
}
