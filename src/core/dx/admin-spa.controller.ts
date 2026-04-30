import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";

import { type AuditBrowserPageInput, type AuditLogEntry } from "./audit-browser-types.js";
import { buildDevPortalShellInput, renderDevPortalShell } from "./dev-portal-shell.js";
import {
  type ActiveSocketEntry,
  type RealtimeChannelEntry,
  type RealtimeChannelsPageInput,
  type RealtimeEventDetail,
  type RealtimeEventEntry,
  type RealtimeInspectorPageInput,
  type RealtimeReplayInput,
  type RealtimeSendInput,
} from "./realtime-inspector-types.js";
import { type SearchTesterPageInput } from "./search-tester-types.js";
import {
  type DeliveryListEntry,
  type DeliveryStatus,
  type EndpointAggregateWithSparkline,
  type InspectorListFilter,
  type WebhookAggregatesResponse,
  type WebhookDeliveryDetailResponse,
  type WebhookInspectorPageInput,
  type WebhookRedeliverResponse,
} from "./webhook-inspector-types.js";
import { RealtimeGateway } from "../realtime/realtime.module.js";
import { serverConfigFromEnv } from "../server/server-config.js";
import { buildPermissionReport, type PermissionReport } from "../permissions/permission-report.js";
import { buildHmacSignatureHeader } from "../webhooks/hmac-signature.js";
import {
  buildEndpointAggregates,
  buildSparkline,
  type DeliveryAggregateInput,
  filterDeliveries,
  type InspectorDeliveryStatus,
} from "../webhooks/inspector-aggregates.js";
import { buildCurlCommand } from "../webhooks/inspector-curl.js";
import { issueCsrfToken, verifyCsrfToken } from "../webhooks/inspector-csrf.js";
import {
  getInspectorCsrfSecret,
  getWebhookInspectorBuffer,
} from "../webhooks/inspector-singleton.js";
import { buildDemoDeliveries } from "../webhooks/inspector-store.js";

/**
 * `/admin/*` SPA shell + JSON sidecars.
 *
 * Replaces the legacy `AdminUiController` which returned server-rendered
 * HTML. Every `GET /admin/<page>` now returns the Dev-Portal SPA shell;
 * the React tree at `src/core/dx/clients/pages/<Page>Page.tsx` fetches
 * the matching `*.json` sidecar to populate itself. Same DOM, same
 * classnames, same chrome — but the canonical surface is the SPA, not
 * the server.
 *
 * All routes 404 outside `NODE_ENV=development`, identical to the Dev-Hub.
 *
 * Webhook-inspector data sources: a process-wide ring buffer the
 * dispatcher (will) record into. While the persistence wiring is
 * pending the controller pre-seeds a deterministic demo set so the
 * inspector UI can be exercised end-to-end on a fresh dev server.
 */

const CSRF_TTL_SECONDS = 30 * 60;
const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 500;

@Controller("admin")
export class AdminSpaController {
  constructor(private readonly realtime: RealtimeGateway) {}

  // ── Permission Tester ────────────────────────────────────────────

  @Get("permissions/test")
  @Header("content-type", "text/html; charset=utf-8")
  permissionsTestPage(): string {
    this.assertDev();
    return renderDevPortalShell(buildDevPortalShellInput({ title: "Permission Tester" }));
  }

  /**
   * `/admin/permissions/test.json` — runs the form lookup. The legacy
   * server page never wired the lookup either (it always rendered the
   * empty form), so this returns a stub report with no rules until the
   * Prisma-backed PermissionStorage adapter lands. The shape pins the
   * contract the React page reads.
   */
  @Get("permissions/test.json")
  permissionsTestJson(
    @Query("userId") userId: string | undefined,
    @Query("tenantId") tenantId: string | undefined,
  ): { report: PermissionReport | null; submitted: { userId: string; tenantId: string } } {
    this.assertDev();
    const submitted = { userId: userId ?? "", tenantId: tenantId ?? "" };
    if (!userId || !tenantId) {
      return { report: null, submitted };
    }
    // No PermissionStorage adapter yet — return the same empty-report
    // shape the legacy page would have shown for a user with no rules.
    const report = buildPermissionReport({ userId, tenantId, rules: [] });
    return { report, submitted };
  }

  // ── Webhook Inspector ───────────────────────────────────────────

  @Get("webhooks")
  @Header("content-type", "text/html; charset=utf-8")
  webhookInspectorPage(): string {
    this.assertDev();
    return renderDevPortalShell(buildDevPortalShellInput({ title: "Webhook Inspector" }));
  }

  @Get("webhooks.json")
  webhookInspectorJson(
    @Query("status") status: string | undefined,
    @Query("endpointId") endpointId: string | undefined,
    @Query("eventType") eventType: string | undefined,
    @Query("from") from: string | undefined,
    @Query("to") to: string | undefined,
    @Query("search") search: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limitRaw: string | undefined,
  ): WebhookInspectorPageInput {
    this.assertDev();
    const limit = clampLimit(limitRaw);
    const filterStatus = normaliseDeliveryStatus(status);
    const filter: InspectorListFilter = { status: filterStatus };
    if (endpointId) filter.endpointId = endpointId;
    if (eventType) filter.eventType = eventType;
    if (from) filter.from = from;
    if (to) filter.to = to;
    if (search) filter.search = search;

    const all = this.snapshotDeliveries();
    const matched = filterDeliveries({
      deliveries: all,
      ...(filter.endpointId !== undefined && { endpointId: filter.endpointId }),
      status: filter.status,
      ...(filter.eventType !== undefined && { eventType: filter.eventType }),
      ...(filter.from !== undefined && { from: filter.from }),
      ...(filter.to !== undefined && { to: filter.to }),
      ...(filter.search !== undefined && { search: filter.search }),
    });
    // Newest-first ordering — the React list scrolls top → bottom.
    const sorted = [...matched].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

    const startIdx = cursor ? Math.max(0, Number(cursor)) : 0;
    const slice = sorted.slice(startIdx, startIdx + limit);
    const hasMore = startIdx + slice.length < sorted.length;

    const result: WebhookInspectorPageInput = {
      deliveries: slice.map(toDeliveryListEntry),
      filter,
      csrfToken: issueCsrfToken({ secret: getInspectorCsrfSecret() }),
    };
    if (hasMore) result.nextCursor = String(startIdx + slice.length);
    return result;
  }

  @Get("webhooks/aggregates.json")
  webhookAggregatesJson(): WebhookAggregatesResponse {
    this.assertDev();
    const now = Date.now();
    const all = this.snapshotDeliveries();
    const aggregates = buildEndpointAggregates({
      deliveries: all,
      now,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const endpoints: EndpointAggregateWithSparkline[] = aggregates.map((agg) => {
      const endpointDeliveries = all.filter((d) => d.endpointId === agg.endpointId);
      return {
        ...agg,
        sparkline: buildSparkline({
          deliveries: endpointDeliveries,
          now,
          bucketCount: 24,
          bucketMs: 60 * 60 * 1000,
        }),
      };
    });
    return { endpoints };
  }

  @Get("webhooks/:id.json")
  webhookDeliveryDetailJson(@Param("id") id: string): WebhookDeliveryDetailResponse {
    this.assertDev();
    const found = getWebhookInspectorBuffer().findById(id) ?? this.findDemoById(id);
    if (!found) throw new NotFoundException();
    const delivery = toDeliveryListEntry(found);

    // Reconstruct the headers the dispatcher would emit so the curl
    // command + drawer "Request" tab show realistic values. The HMAC
    // is computed against the demo body and a deterministic timestamp
    // — production deliveries will replace this with persisted headers.
    const ts = Math.floor(Date.parse(delivery.occurredAt) / 1000).toString();
    const body = JSON.stringify({
      eventId: delivery.id,
      eventType: delivery.eventType ?? "unknown",
      occurredAt: delivery.occurredAt,
    });
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "webhook-id": delivery.id,
      "webhook-timestamp": ts,
      "webhook-signature": buildHmacSignatureHeader("inspector-demo-secret", ts, body),
    };

    const detail: WebhookDeliveryDetailResponse["delivery"] = {
      ...delivery,
      requestHeaders: headers,
      requestBody: body,
    };
    if (delivery.statusCode !== undefined) {
      detail.responseHeaders = {
        "content-type": "application/json",
      };
      detail.responseBody = delivery.errorMessage
        ? JSON.stringify({ error: delivery.errorMessage })
        : JSON.stringify({ ok: true });
    }

    return {
      delivery: detail,
      curl: buildCurlCommand({
        url: delivery.endpointUrl,
        method: "POST",
        headers,
        body,
      }),
    };
  }

  /**
   * Manual re-deliver action — gated by a per-request CSRF token issued
   * via `/admin/webhooks.json`. Idempotent in the sense that a tampered
   * or stale token is rejected without touching the buffer.
   */
  @Post("webhooks/:id/redeliver")
  @HttpCode(200)
  redeliverWebhook(
    @Param("id") id: string,
    @Body() body: { csrfToken?: string } | undefined,
  ): WebhookRedeliverResponse {
    this.assertDev();
    const token = body?.csrfToken ?? "";
    if (!token) {
      throw new ForbiddenException("missing CSRF token");
    }
    const ok = verifyCsrfToken({
      token,
      secret: getInspectorCsrfSecret(),
      now: Math.floor(Date.now() / 1000),
      ttlSeconds: CSRF_TTL_SECONDS,
    });
    if (!ok) {
      throw new ForbiddenException("invalid or expired CSRF token");
    }

    const buffer = getWebhookInspectorBuffer();
    let existing = buffer.findById(id);
    if (!existing) {
      // Demo-seed entries live outside the buffer; copy on first
      // re-deliver so subsequent attempts persist for the session.
      const demoEntry = this.findDemoById(id);
      if (demoEntry) {
        buffer.record(demoEntry);
        existing = buffer.findById(id);
      }
    }
    if (!existing) throw new NotFoundException();

    const updated = buffer.appendAttempt(id, {
      // Demo redelivery is always treated as successful — production
      // wiring will execute the real HTTP POST and record actual
      // status/latency.
      status: "DELIVERED",
      statusCode: 200,
      latencyMs: 95,
      occurredAt: new Date().toISOString(),
    });
    if (!updated) throw new NotFoundException();
    return { delivery: toDeliveryListEntry(updated) };
  }

  // ── Realtime Inspector ──────────────────────────────────────────

  @Get("realtime")
  @Header("content-type", "text/html; charset=utf-8")
  realtimeInspectorPage(): string {
    this.assertDev();
    return renderDevPortalShell(buildDevPortalShellInput({ title: "Realtime Inspector" }));
  }

  @Get("realtime.json")
  realtimeInspectorJson(): RealtimeInspectorPageInput {
    this.assertDev();
    const snapshot = this.realtime.inspectorSnapshot();
    const sockets: ActiveSocketEntry[] = snapshot.sockets.map((s) => ({
      id: s.id,
      userId: s.userId,
      tenantId: s.tenantId,
      channels: s.channels,
      connectedAt: s.connectedAt,
      bytesSent: s.bytesSent,
      bytesReceived: s.bytesReceived,
      ...(s.lastPingMs !== undefined ? { lastPingMs: s.lastPingMs } : {}),
      ...(s.userAgent !== undefined ? { userAgent: s.userAgent } : {}),
    }));
    const channels: RealtimeChannelEntry[] = snapshot.channels.map((c) => ({
      name: c.name,
      subscriberCount: c.subscriberCount,
      subscriberIds: c.subscriberIds,
      eventsLastHour: c.eventsLastHour,
      p95LatencyMs: c.p95LatencyMs,
    }));
    const eventsDetailed: RealtimeEventDetail[] = snapshot.events.map((e) => ({
      channel: e.channel,
      eventType: e.eventType,
      payload: e.payload,
      recipientCount: e.recipientCount,
      latencyMs: e.latencyMs,
      occurredAt: e.occurredAt,
    }));
    const events: RealtimeEventEntry[] = eventsDetailed.map((e) => ({
      channel: e.channel,
      eventType: e.eventType,
      payloadPreview: previewPayload(e.payload),
      occurredAt: e.occurredAt,
    }));
    return {
      sockets,
      channels,
      events,
      eventsDetailed,
      eventsPerSecond: snapshot.eventsPerSecond,
    };
  }

  @Get("realtime/channels.json")
  realtimeChannelsJson(): RealtimeChannelsPageInput {
    this.assertDev();
    const snapshot = this.realtime.inspectorSnapshot();
    const channels: RealtimeChannelEntry[] = snapshot.channels.map((c) => ({
      name: c.name,
      subscriberCount: c.subscriberCount,
      subscriberIds: c.subscriberIds,
      eventsLastHour: c.eventsLastHour,
      p95LatencyMs: c.p95LatencyMs,
    }));
    return { channels };
  }

  @Post("realtime/sockets/:id/disconnect")
  @HttpCode(200)
  realtimeDisconnectSocket(@Param("id") id: string): { id: string } {
    this.assertDev();
    const ok = this.realtime.disconnectSocket(id);
    if (!ok) throw new NotFoundException(`unknown socket "${id}"`);
    return { id };
  }

  @Post("realtime/sockets/:id/send")
  @HttpCode(200)
  realtimeSendToSocket(
    @Param("id") id: string,
    @Body() body: Partial<RealtimeSendInput>,
  ): { delivered: true } {
    this.assertDev();
    if (!body || typeof body.eventType !== "string" || !body.eventType) {
      throw new BadRequestException("eventType (non-empty string) is required");
    }
    const ok = this.realtime.sendToSocket(id, body.eventType, body.payload);
    if (!ok) throw new NotFoundException(`unknown socket "${id}"`);
    return { delivered: true };
  }

  @Post("realtime/events/replay")
  @HttpCode(200)
  realtimeReplayEvent(@Body() body: Partial<RealtimeReplayInput>): { replayed: true } {
    this.assertDev();
    if (
      !body ||
      typeof body.channel !== "string" ||
      !body.channel ||
      typeof body.eventType !== "string" ||
      !body.eventType
    ) {
      throw new BadRequestException("channel + eventType (non-empty strings) are required");
    }
    this.realtime.replayEvent(body.channel, body.eventType, body.payload);
    return { replayed: true };
  }

  // ── Audit Browser ───────────────────────────────────────────────

  @Get("audit")
  @Header("content-type", "text/html; charset=utf-8")
  auditBrowserPage(): string {
    this.assertDev();
    return renderDevPortalShell(buildDevPortalShellInput({ title: "Audit Browser" }));
  }

  @Get("audit.json")
  auditBrowserJson(
    @Query("action") action: string | undefined,
    @Query("resource") resource: string | undefined,
    @Query("actorUserId") actorUserId: string | undefined,
    @Query("from") from: string | undefined,
    @Query("to") to: string | undefined,
  ): AuditBrowserPageInput {
    this.assertDev();
    const filter: AuditBrowserPageInput["filter"] = {};
    if (action) filter.action = action;
    if (resource) filter.resource = resource;
    if (actorUserId) filter.actorUserId = actorUserId;
    if (from) filter.from = from;
    if (to) filter.to = to;
    const entries: AuditLogEntry[] = [];
    return { entries, filter };
  }

  // ── Search Tester ───────────────────────────────────────────────

  @Get("search")
  @Header("content-type", "text/html; charset=utf-8")
  searchTesterPage(): string {
    this.assertDev();
    return renderDevPortalShell(buildDevPortalShellInput({ title: "Search Tester" }));
  }

  @Get("search.json")
  searchTesterJson(@Query("q") q: string | undefined): SearchTesterPageInput {
    this.assertDev();
    if (q === undefined) {
      return { hits: [] };
    }
    // The legacy renderer trusted `ts_headline`'s `<b>...</b>` highlight
    // tags. Until the cross-resource FTS service is wired here, we
    // return an empty result — the React page renders the "no results"
    // empty state without trusting any payload fragment.
    return { query: q, hits: [] };
  }

  // ── helpers ─────────────────────────────────────────────────────

  private snapshotDeliveries(): DeliveryAggregateInput[] {
    const buf = getWebhookInspectorBuffer().recent();
    if (buf.length > 0) return [...buf];
    return buildDemoDeliveries({ now: Date.now() });
  }

  private findDemoById(id: string): DeliveryAggregateInput | null {
    const demos = buildDemoDeliveries({ now: Date.now() });
    return demos.find((d) => d.id === id) ?? null;
  }

  private assertDev(): void {
    const cfg = serverConfigFromEnv(process.env);
    if (cfg.env !== "development") {
      throw new NotFoundException();
    }
  }
}

function normaliseDeliveryStatus(value: string | undefined): InspectorDeliveryStatus | "ALL" {
  if (value === "DELIVERED" || value === "FAILED" || value === "PENDING") return value;
  return "ALL";
}

function clampLimit(raw: string | undefined): number {
  if (!raw) return DEFAULT_PAGE_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAGE_LIMIT;
  return Math.min(MAX_PAGE_LIMIT, Math.floor(n));
}

function toDeliveryListEntry(record: DeliveryAggregateInput): DeliveryListEntry {
  const entry: DeliveryListEntry = {
    id: record.id,
    endpointId: record.endpointId,
    endpointUrl: record.endpointUrl,
    status: record.status as DeliveryStatus,
    attemptCount: record.attemptCount,
    occurredAt: record.occurredAt,
  };
  if (record.eventType !== undefined) entry.eventType = record.eventType;
  if (record.statusCode !== undefined) entry.statusCode = record.statusCode;
  if (record.latencyMs !== undefined) entry.latencyMs = record.latencyMs;
  if (record.errorMessage !== undefined) entry.errorMessage = record.errorMessage;
  return entry;
}

function previewPayload(payload: unknown): string {
  try {
    const json = JSON.stringify(payload);
    if (!json) return "";
    return json.length > 80 ? `${json.slice(0, 80)}…` : json;
  } catch {
    return "[unserializable]";
  }
}
