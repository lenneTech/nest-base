import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Req,
} from "@nestjs/common";
import type { Request } from "express";

import { Can } from "../permissions/can.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { GdprExportJobRegistry, type GdprExportJob } from "./gdpr-export.registry.js";
import { buildGdprExport } from "./gdpr.service.js";

interface AuthedRequest extends Request {
  user?: { id: string; tenantId?: string };
}

/**
 * GDPR / data-protection endpoints (Art. 15 + Art. 17).
 *
 * `GET /me/export` returns the canonical `GdprExportPayload` —
 * project domain modules contribute additional resources via the
 * `relatedResources` map; the controller's default emits an empty
 * resource set so the frontend always has a valid envelope.
 *
 * `DELETE /me/account` records a row in `pending_erasures`. The
 * `GdprErasureRunner` daily cron (CF.GDPR.04) walks pending rows
 * past the 30-day grace window and anonymises the User. Repeated
 * calls collapse to a single active request — the controller
 * returns the original `requestedAt` so the UI can render
 * "your account erases on <requestedAt + 30 days>".
 *
 * Permission gating: both handlers carry `@Can()` so the unified
 * CASL ability check applies. The `req.user` nullcheck is
 * defense-in-depth — `CanGuard` returns 403 for an empty ability,
 * but the explicit check makes the intent obvious in the handler.
 */
@Controller("me")
export class GdprController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exportJobs: GdprExportJobRegistry,
  ) {}

  /**
   * `GET /me/export` — async export-job entry point. Enqueues a
   * `gdpr.export` job for the authenticated user, runs the
   * synthesizer in the background, returns the job id immediately so
   * the UI can poll. The synchronous payload is gone — even small
   * exports take a non-trivial round-trip, and Article 20's right to
   * data portability is by spirit asynchronous (the user requests an
   * export, the system delivers it via a download link).
   */
  @Can("export", "GdprData")
  @Get("export")
  async export(@Req() req: AuthedRequest): Promise<{
    jobId: string;
    status: GdprExportJob["status"];
    requestedAt: string;
  }> {
    if (!req.user) {
      throw new ForbiddenException("authentication required");
    }
    const job = this.exportJobs.enqueue({
      userId: req.user.id,
      tenantId: req.user.tenantId ?? null,
    });
    // Run the export synthesizer asynchronously — the controller
    // returns immediately; the job transitions PENDING → RUNNING →
    // COMPLETED in the background.
    void this.runExport(job.id, req.user.id, req.user.tenantId ?? null);
    return {
      jobId: job.id,
      status: job.status,
      requestedAt: job.requestedAt.toISOString(),
    };
  }

  /**
   * `GET /me/export/:jobId` — poll endpoint. Returns the job status;
   * when COMPLETED the response also carries the canonical
   * `GdprExportPayload`. Anonymous-access guard: the path is gated
   * by the same `export:GdprData` ability AND we cross-check the
   * job's userId against the request's user so a tenant member can't
   * read another user's export by id.
   */
  @Can("export", "GdprData")
  @Get("export/:jobId")
  async exportStatus(
    @Param("jobId") jobId: string,
    @Req() req: AuthedRequest,
  ): Promise<{
    jobId: string;
    status: GdprExportJob["status"];
    requestedAt: string;
    completedAt: string | null;
    payload: unknown;
    error: string | null;
  }> {
    if (!req.user) {
      throw new ForbiddenException("authentication required");
    }
    const job = this.exportJobs.get(jobId);
    if (!job) {
      throw new NotFoundException(`gdpr export job not found: ${jobId}`);
    }
    if (job.userId !== req.user.id) {
      throw new ForbiddenException("export job belongs to another user");
    }
    return {
      jobId: job.id,
      status: job.status,
      requestedAt: job.requestedAt.toISOString(),
      completedAt: job.completedAt ? job.completedAt.toISOString() : null,
      payload: job.payload,
      error: job.error,
    };
  }

  private async runExport(jobId: string, userId: string, tenantId: string | null): Promise<void> {
    try {
      this.exportJobs.start(jobId);
      const payload = buildGdprExport({
        user: { id: userId, tenantId },
        relatedResources: {},
        now: () => Date.now(),
      });
      this.exportJobs.complete(jobId, payload);
    } catch (err) {
      this.exportJobs.fail(jobId, err instanceof Error ? err : new Error(String(err)));
    }
  }

  @Can("delete", "Account")
  @Delete("account")
  async deleteAccount(@Req() req: AuthedRequest): Promise<{
    status: "pending";
    userId: string;
    requestedAt: string;
  }> {
    if (!req.user) {
      throw new ForbiddenException("authentication required");
    }
    // Persist the request — the GdprErasureRunner's daily tick reads
    // pending_erasures rows whose requested_at is more than 30 days
    // old (CF.GDPR.04 grace period) and anonymises the user via the
    // factory bound in GdprModule.
    //
    // Idempotency: the user can call DELETE /me/account multiple
    // times; we collapse repeats to one active row by skipping when
    // an uncompleted, uncancelled request already exists. The
    // returned `requestedAt` is the original request's timestamp,
    // which the UI uses to render "your account erases on
    // <requestedAt + 30 days>".
    const existing = (await this.prisma.$queryRawUnsafe(
      `SELECT requested_at FROM pending_erasures
        WHERE user_id = $1::uuid
          AND completed_at IS NULL
          AND cancelled_at IS NULL
        ORDER BY requested_at ASC
        LIMIT 1`,
      req.user.id,
    )) as Array<{ requested_at: Date }>;

    const requestedAt =
      existing[0]?.requested_at ?? ((await this.insertPendingErasure(req.user.id)) as Date);
    return {
      status: "pending",
      userId: req.user.id,
      requestedAt: requestedAt.toISOString(),
    };
  }

  private async insertPendingErasure(userId: string): Promise<Date> {
    const inserted = (await this.prisma.$queryRawUnsafe(
      `INSERT INTO pending_erasures (id, user_id, requested_at)
       VALUES (gen_random_uuid(), $1::uuid, NOW())
       RETURNING requested_at`,
      userId,
    )) as Array<{ requested_at: Date }>;
    const row = inserted[0];
    if (!row) {
      throw new Error("gdpr: failed to record pending erasure");
    }
    return row.requested_at;
  }
}
