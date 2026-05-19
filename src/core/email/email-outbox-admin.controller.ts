import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";

import { Can } from "../permissions/can.guard.js";
import { parseOutboxListFilter, planOutboxAdminAction } from "./email-outbox-action-planner.js";
import type {
  EmailOutboxListResult,
  EmailOutboxRecord,
  EmailOutboxStorage,
} from "./email-outbox.js";
import { outboxPayloadSummary } from "./email-outbox-dto.js";
import { EMAIL_OUTBOX_STORAGE } from "./email-outbox.module.js";
import { EmailService } from "./email.service.js";
import { PLAN_OK } from "../result/plan-ok.js";

/**
 * EmailOutboxAdminController — `/admin/email-outbox` (issue #91).
 *
 * Operator surface for inspecting and acting on email-outbox rows.
 * All JSON / action routes are gated by `@Can('manage', 'EmailOutboxAdmin')`.
 * The React SPA shell is served separately (public under `/admin/` prefix);
 * operators sign in via Better-Auth and need `manage:EmailOutboxAdmin` (or
 * `manage:all` on the system-admin role from seed).
 *
 * Routes:
 *   GET  /admin/email-outbox/list.json          — paginated list with filters
 *   GET  /admin/email-outbox/:id.json           — full detail
 *   POST /admin/email-outbox/:id/retry          — reset attempts (pending|dead-letter only)
 *   POST /admin/email-outbox/:id/cancel         — set status=cancelled (pending|dead-letter only)
 *   POST /admin/email-outbox/test-send          — fire a template through outbox mode
 *
 * State-transition decisions are delegated to `planOutboxAdminAction`
 * (pure planner, no DB) so the policy is story-testable in isolation.
 */

export const EMAIL_OUTBOX_ADMIN_STORAGE = Symbol.for("lt:EmailOutboxAdminStorage");

export interface OutboxRecordDto {
  id: string;
  kind: string;
  status: string;
  recipient: string | null;
  template: string | null;
  attemptCount: number;
  nextAttemptAt: string | null;
  claimedAt: string | null;
  lastError: string | null;
  succeededAt: string | null;
  failedAt: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
}

function toDto(r: EmailOutboxRecord): OutboxRecordDto {
  const { recipient, template } = outboxPayloadSummary(r.payload);
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    recipient,
    template,
    attemptCount: r.attemptCount,
    nextAttemptAt: r.nextAttemptAt?.toISOString() ?? null,
    claimedAt: r.claimedAt?.toISOString() ?? null,
    lastError: r.lastError,
    succeededAt: r.succeededAt?.toISOString() ?? null,
    failedAt: r.failedAt?.toISOString() ?? null,
    idempotencyKey: r.idempotencyKey,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

@Controller("admin/email-outbox")
export class EmailOutboxAdminController {
  constructor(
    @Inject(EMAIL_OUTBOX_STORAGE) private readonly storage: EmailOutboxStorage,
    private readonly emailService: EmailService,
  ) {}

  /**
   * `GET /admin/email-outbox/list.json` — paginated list with filters.
   *
   * Query params: status, recipient, template, dateFrom, dateTo,
   *               sortBy (time|attempts), cursor, limit (1–200, default 50).
   */
  @Can("manage", "EmailOutboxAdmin")
  @Get("list.json")
  async list(
    @Query()
    query: {
      status?: string;
      recipient?: string;
      template?: string;
      dateFrom?: string;
      dateTo?: string;
      sortBy?: string;
      cursor?: string;
      limit?: string;
    },
  ): Promise<{ items: OutboxRecordDto[]; nextCursor?: string; total: number }> {
    const parsed = parseOutboxListFilter(query);
    if (!parsed.ok) throw new BadRequestException(parsed.reason);

    const result: EmailOutboxListResult = await this.storage.listFiltered(parsed.filter);
    return {
      items: result.items.map(toDto),
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      total: result.total,
    };
  }

  /**
   * `GET /admin/email-outbox/:id.json` — full record detail.
   * Returns all fields including the raw payload (template vars, recipient).
   */
  @Can("manage", "EmailOutboxAdmin")
  @Get(":id.json")
  async detail(@Param("id") id: string): Promise<{ record: OutboxRecordDto; payload: unknown }> {
    const record = await this.storage.findById(id);
    if (!record) throw new NotFoundException(`email-outbox record ${id} not found`);
    return { record: toDto(record), payload: record.payload };
  }

  /**
   * `POST /admin/email-outbox/:id/retry` — reset attempts so the worker
   * picks the record up again. Forbidden when status is `sent` or `cancelled`.
   */
  @Can("manage", "EmailOutboxAdmin")
  @Post(":id/retry")
  async retry(@Param("id") id: string): Promise<{ ok: true }> {
    const record = await this.storage.findById(id);
    if (!record) throw new NotFoundException(`email-outbox record ${id} not found`);

    const decision = planOutboxAdminAction("retry", record.status);
    if (!decision.allowed) throw new ForbiddenException(decision.reason);

    await this.storage.markRetry(id, new Date());
    return PLAN_OK;
  }

  /**
   * `POST /admin/email-outbox/:id/cancel` — mark the record cancelled.
   * Forbidden when status is `sent` or already `cancelled`.
   */
  @Can("manage", "EmailOutboxAdmin")
  @Post(":id/cancel")
  async cancel(@Param("id") id: string): Promise<{ ok: true }> {
    const record = await this.storage.findById(id);
    if (!record) throw new NotFoundException(`email-outbox record ${id} not found`);

    const decision = planOutboxAdminAction("cancel", record.status);
    if (!decision.allowed) throw new ForbiddenException(decision.reason);

    await this.storage.markCancelled(id, new Date());
    return PLAN_OK;
  }

  /**
   * `POST /admin/email-outbox/test-send` — fire a test email through the
   * outbox. Body: `{ template, locale?, vars?, recipient }`. Returns the
   * synthetic outbox message id so the operator can track the row.
   */
  @Can("manage", "EmailOutboxAdmin")
  @Post("test-send")
  async testSend(
    @Body()
    body: { template?: unknown; locale?: unknown; vars?: unknown; recipient?: unknown },
  ): Promise<{ id: string }> {
    if (!body || typeof body.template !== "string" || body.template.trim() === "") {
      throw new BadRequestException("template (non-empty string) is required");
    }
    if (!body.recipient || typeof body.recipient !== "string" || body.recipient.trim() === "") {
      throw new BadRequestException("recipient (non-empty string) is required");
    }
    const vars = body.vars && typeof body.vars === "object" ? (body.vars as object) : {};
    const locale = typeof body.locale === "string" ? body.locale : "en";

    const result = await this.emailService.sendTemplate(
      {
        to: body.recipient,
        template: body.template,
        locale,
        vars,
      },
      { mode: "outbox" },
    );

    // The outbox message id is `outbox:<uuid>` — strip the prefix for the response.
    const rawId = result.messageId.startsWith("outbox:")
      ? result.messageId.slice("outbox:".length)
      : result.messageId;

    return { id: rawId };
  }
}
