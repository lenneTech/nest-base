import { Injectable } from "@nestjs/common";

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
  };
}

/**
 * Aggregates readiness checks. Currently only Postgres connectivity —
 * later slices add Redis/RustFS/queue once those land.
 */
@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

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

  async readiness(): Promise<ReadinessReport> {
    const database = await this.checkDatabase();
    const status: ReadinessReport["status"] = database.status === "ok" ? "ok" : "fail";
    return { status, checks: { database } };
  }
}
