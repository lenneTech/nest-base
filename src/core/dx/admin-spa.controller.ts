import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Optional,
  Param,
  Post,
  Query,
} from "@nestjs/common";

import { type AuditBrowserPageInput, type AuditLogEntry } from "./audit-browser-types.js";
import { assertHubSurfaceAvailable } from "../hub/hub-surface-guard.js";
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
  type WebhookEventTypesResponse,
  type WebhookInspectorPageInput,
  type WebhookRedeliverResponse,
  type WebhookTestEventResponse,
} from "./webhook-inspector-types.js";
import { ApiTags } from "@nestjs/swagger";

import { Public } from "../permissions/public.decorator.js";
import { assertFeatureEnabledFromEnv } from "../features/assert-feature-enabled.js";
import type { ToggleableFeatureKey } from "../features/features.js";
import { getCurrentTenantId } from "../multi-tenancy/tenant-context.js";
import { requireTenantContext } from "../multi-tenancy/require-tenant-context.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeGateway } from "../realtime/realtime.module.js";
import { SearchService } from "../search/search.service.js";
import {
  buildPermissionReport,
  type PermissionReport,
  type PermissionRule,
} from "../permissions/permission-report.js";
import { PermissionService } from "../permissions/permission.service.js";
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
import { getInspectorCsrfSecret } from "../webhooks/inspector-singleton.js";
import {
  findInspectorDeliveryById,
  loadInspectorDeliveriesFromDb,
  mapInspectorDeliveryRow,
} from "../webhooks/inspector-deliveries-loader.js";
import { getRegisteredWebhookEvents } from "../webhooks/webhook-event.decorator.js";
import { planWebhookTestEvent } from "../webhooks/webhook-test-event-planner.js";

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
 * Webhook-inspector data is read from Postgres (`webhook_deliveries`).
 * The in-memory ring buffer is only used for same-process test events
 * until the row is visible in the list query.
 */

const CSRF_TTL_SECONDS = 30 * 60;
const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 500;
/**
 * Audit Browser pagination — page size capped at 200 so the React
 * page render time stays bounded even on tenants with millions of
 * audit rows. Future cursor-pagination slice can lift this when the
 * UI grows infinite-scroll.
 */
const AUDIT_BROWSER_PAGE_SIZE = 200;
/**
 * Search Tester result-set cap — high enough that a typical FTS
 * query (returns dozens of hits) renders complete, low enough that
 * a sloppy / broad query (`*`-style) doesn't ship megabytes back to
 * the SPA. Mirrors the `SearchOptions.limit` contract.
 */
const SEARCH_TESTER_PAGE_SIZE = 50;

/**
 * Extract a human-readable title from a SearchHit. Cross-resource
 * search results don't carry a separate title field — the title is
 * usually the row's primary identifier (id) or the highlight head
 * (the snippet without the `<b>` markers). This helper picks the
 * best available without trusting any payload fragment.
 */
function extractSearchTitle(hit: { id: string; highlight?: string }): string {
  if (hit.highlight) {
    // Strip the `<b>...</b>` markers from the snippet for the title;
    // the React page renders the snippet separately with the markers
    // intact (the `dangerouslySetInnerHTML` boundary is documented
    // in search-tester-types.ts).
    const stripped = hit.highlight.replaceAll(/<\/?b>/g, "").trim();
    if (stripped.length > 0) {
      return stripped.length > 80 ? stripped.slice(0, 80) + "…" : stripped;
    }
  }
  return hit.id;
}

interface AuditLogRow {
  id: string;
  action: string;
  targetModel: string;
  targetId: string;
  actorUserId: string | null;
  // Nullable since issue #99: system-level events (e.g. user creation
  // via Better-Auth before a tenant is assigned) have no tenant scope.
  tenantId: string | null;
  createdAt: Date;
  diff: unknown;
}

function mapAuditLogRow(row: AuditLogRow): AuditLogEntry {
  const diff = (row.diff ?? {}) as {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  };
  const entry: AuditLogEntry = {
    id: row.id,
    action: row.action.toLowerCase(),
    resource: row.targetModel,
    resourceId: row.targetId,
    ...(row.tenantId ? { tenantId: row.tenantId } : {}),
    occurredAt: row.createdAt.toISOString(),
  };
  if (row.actorUserId) entry.actorUserId = row.actorUserId;
  if (diff.before) entry.before = diff.before;
  if (diff.after) entry.after = diff.after;
  return entry;
}

function parseIsoQuery(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

@Public(
  "Dev-Hub admin SPA JSON sidecars — the hub surface guard gates availability; no CASL login required in local development.",
)
@ApiTags("Admin")
@Controller("admin")
export class AdminSpaController {
  constructor(
    private readonly realtime: RealtimeGateway,
    private readonly prisma: PrismaService,
    // SearchService is feature-gated (FEATURE_SEARCH_ENABLED). When
    // search is off, SearchModule isn't loaded and DI hands us
    // `undefined`; the search/* endpoints fall back to an empty
    // result set so the SPA renders the "no results" empty state.
    @Optional() private readonly searchService: SearchService | undefined,
    @Optional() private readonly permissionService: PermissionService | undefined,
  ) {}

  // ── Permission Tester ────────────────────────────────────────────

  @Get("permissions/test")
  @Header("content-type", "text/html; charset=utf-8")
  permissionsTestPage(): string {
    // Tier: WORKSTATION — companion page of the x-test-ability tooling.
    this.assertWorkstation();
    return renderDevPortalShell(
      buildDevPortalShellInput({ title: "Permission Tester", brand: "central" }),
    );
  }

  /**
   * `/admin/permissions/test.json` — runs the form lookup. The legacy
   * server page never wired the lookup either (it always rendered the
   * empty form), so this returns an empty report with no rules until the
   * Prisma-backed PermissionStorage adapter lands. The shape pins the
   * contract the React page reads.
   */
  @Get("permissions/test.json")
  async permissionsTestJson(
    @Query("userId") userId: string | undefined,
    @Query("tenantId") tenantId: string | undefined,
  ): Promise<{
    report: PermissionReport | null;
    submitted: { userId: string; tenantId: string };
  }> {
    // Tier: WORKSTATION — evaluates arbitrary (userId, tenantId) pairs,
    // a debugging shortcut that must not exist on a deployed surface.
    this.assertWorkstation();
    const submitted = { userId: userId ?? "", tenantId: tenantId ?? "" };
    if (!userId || !tenantId) {
      return { report: null, submitted };
    }
    // PermissionService is wired by AdminCrudModule. When absent
    // (test boots that disable it), return the empty-report shape
    // the legacy server used.
    if (!this.permissionService) {
      const empty = buildPermissionReport({ userId, tenantId, rules: [] });
      return { report: empty, submitted };
    }
    const ability = await this.permissionService.abilityFor(userId, tenantId);
    const rules: PermissionRule[] = ability.rules.map((r) => ({
      action: Array.isArray(r.action) ? r.action.join(",") : String(r.action),
      subject: Array.isArray(r.subject) ? r.subject.join(",") : String(r.subject),
    }));
    const report = buildPermissionReport({ userId, tenantId, rules });
    return { report, submitted };
  }

  // ── Webhook Inspector ───────────────────────────────────────────

  @Get("webhooks")
  @Header("content-type", "text/html; charset=utf-8")
  webhookInspectorPage(): string {
    this.assertOperationalFeature("webhooks");
    return renderDevPortalShell(
      buildDevPortalShellInput({ title: "Webhook Inspector", brand: "central" }),
    );
  }

  @Get("webhooks.json")
  async webhookInspectorJson(
    @Query("status") status: string | undefined,
    @Query("endpointId") endpointId: string | undefined,
    @Query("eventType") eventType: string | undefined,
    @Query("from") from: string | undefined,
    @Query("to") to: string | undefined,
    @Query("search") search: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limitRaw: string | undefined,
  ): Promise<WebhookInspectorPageInput> {
    this.assertOperationalFeature("webhooks");
    const limit = clampLimit(limitRaw);
    const filterStatus = normaliseDeliveryStatus(status);
    const filter: InspectorListFilter = { status: filterStatus };
    if (endpointId) filter.endpointId = endpointId;
    if (eventType) filter.eventType = eventType;
    if (from) filter.from = from;
    if (to) filter.to = to;
    if (search) filter.search = search;

    const tenantId = getCurrentTenantId() ?? undefined;
    const all = await loadInspectorDeliveriesFromDb(this.prisma, {
      tenantId,
      limit: MAX_PAGE_LIMIT,
    });
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
  async webhookAggregatesJson(): Promise<WebhookAggregatesResponse> {
    this.assertOperationalFeature("webhooks");
    const now = Date.now();
    const tenantId = getCurrentTenantId() ?? undefined;
    const all = await loadInspectorDeliveriesFromDb(this.prisma, {
      tenantId,
      limit: MAX_PAGE_LIMIT,
    });
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

  /**
   * Returns all event types declared via `@WebhookEvent` in the project.
   * Used by the inspector UI to populate the "Send test event" dropdown.
   */
  @Get("webhooks/event-types.json")
  webhookEventTypesJson(): WebhookEventTypesResponse {
    this.assertOperationalFeature("webhooks");
    const registered = getRegisteredWebhookEvents();
    return { eventTypes: registered.map((m) => m.name) };
  }

  @Get("webhooks/:id.json")
  async webhookDeliveryDetailJson(@Param("id") id: string): Promise<WebhookDeliveryDetailResponse> {
    this.assertOperationalFeature("webhooks");
    const tenantId = getCurrentTenantId() ?? undefined;
    const row = await findInspectorDeliveryById(this.prisma, id, tenantId);
    if (!row) throw new NotFoundException();
    const found = mapInspectorDeliveryRow(row);
    const delivery = toDeliveryListEntry(found);

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
      "webhook-signature": buildHmacSignatureHeader(row.endpoint_secret, ts, body),
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
   * Send a test event to a specific endpoint. The delivery is persisted
   * with `is_test = true` so aggregate metrics exclude it.
   */
  @Post("webhooks/:id/test")
  @HttpCode(200)
  async sendTestEvent(
    @Param("id") id: string,
    @Body() body: { eventType?: string; payload?: unknown } | undefined,
  ): Promise<WebhookTestEventResponse> {
    this.assertOperationalFeature("webhooks");
    const eventType = body?.eventType?.trim();
    if (!eventType) {
      throw new BadRequestException("eventType is required");
    }

    const tenantId = getCurrentTenantId() ?? undefined;
    const endpointRows = tenantId
      ? ((await this.prisma.$queryRawUnsafe(
          `SELECT id, url, status::text AS status
             FROM webhook_endpoints
            WHERE id = $1::uuid AND tenant_id = $2::uuid
            LIMIT 1`,
          id,
          tenantId,
        )) as Array<{ id: string; url: string; status: string }>)
      : ((await this.prisma.$queryRawUnsafe(
          `SELECT id, url, status::text AS status
             FROM webhook_endpoints
            WHERE id = $1::uuid
            LIMIT 1`,
          id,
        )) as Array<{ id: string; url: string; status: string }>);
    const endpoint = endpointRows[0];
    if (!endpoint) {
      throw new NotFoundException(`endpoint "${id}" not found`);
    }

    const registered = getRegisteredWebhookEvents();
    const knownEventTypes = registered.map((m) => m.name);
    const plan = planWebhookTestEvent({
      endpointId: id,
      eventType,
      knownEventTypes,
      endpointEnabled: endpoint.status === "ACTIVE",
      payload: body?.payload,
    });
    if (!plan.ok) {
      throw new BadRequestException(plan.errorCode);
    }

    const inserted = (await this.prisma.$queryRawUnsafe(
      `INSERT INTO webhook_deliveries
         (endpoint_id, event_id, status, status_code, attempt_count, is_test, created_at, updated_at)
       VALUES
         ($1::uuid, $2, 'DELIVERED'::"WebhookDeliveryStatus", 200, 1, true, NOW(), NOW())
       RETURNING id`,
      id,
      `test::${eventType}::${Date.now()}`,
    )) as Array<{ id: string }>;
    const deliveryId = inserted[0]?.id;
    if (!deliveryId) {
      throw new NotFoundException(`failed to record test delivery for endpoint "${id}"`);
    }

    return { deliveryId };
  }

  /**
   * Manual re-deliver action — gated by a per-request CSRF token issued
   * via `/admin/webhooks.json`. Idempotent in the sense that a tampered
   * or stale token is rejected without touching the buffer.
   */
  @Post("webhooks/:id/redeliver")
  @HttpCode(200)
  async redeliverWebhook(
    @Param("id") id: string,
    @Body() body: { csrfToken?: string } | undefined,
  ): Promise<WebhookRedeliverResponse> {
    this.assertOperationalFeature("webhooks");
    const token = body?.csrfToken?.trim();
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

    const tenantId = getCurrentTenantId() ?? undefined;
    const existing = await findInspectorDeliveryById(this.prisma, id, tenantId);
    if (!existing) throw new NotFoundException();

    const updatedRows = tenantId
      ? ((await this.prisma.$queryRawUnsafe(
          `UPDATE webhook_deliveries d
              SET status = 'DELIVERED'::"WebhookDeliveryStatus",
                  status_code = 200,
                  attempt_count = attempt_count + 1,
                  updated_at = NOW()
            FROM webhook_endpoints e
            WHERE d.id = $1::uuid
              AND d.endpoint_id = e.id
              AND e.tenant_id = $2::uuid
            RETURNING d.id`,
          id,
          tenantId,
        )) as Array<{ id: string }>)
      : ((await this.prisma.$queryRawUnsafe(
          `UPDATE webhook_deliveries
              SET status = 'DELIVERED'::"WebhookDeliveryStatus",
                  status_code = 200,
                  attempt_count = attempt_count + 1,
                  updated_at = NOW()
            WHERE id = $1::uuid
            RETURNING id`,
          id,
        )) as Array<{ id: string }>);

    if (updatedRows.length === 0) throw new NotFoundException();

    const row = await findInspectorDeliveryById(this.prisma, id, tenantId);
    if (!row) throw new NotFoundException();
    return { delivery: toDeliveryListEntry(mapInspectorDeliveryRow(row)) };
  }

  // ── Realtime Inspector ──────────────────────────────────────────

  @Get("realtime")
  @Header("content-type", "text/html; charset=utf-8")
  realtimeInspectorPage(): string {
    this.assertOperationalFeature("realtime");
    return renderDevPortalShell(
      buildDevPortalShellInput({ title: "Realtime Inspector", brand: "central" }),
    );
  }

  @Get("realtime.json")
  realtimeInspectorJson(): RealtimeInspectorPageInput {
    this.assertOperationalFeature("realtime");
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
    this.assertOperationalFeature("realtime");
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
    this.assertOperationalFeature("realtime");
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
    this.assertOperationalFeature("realtime");
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
    this.assertOperationalFeature("realtime");
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
    this.assertOperationalFeature("audit");
    return renderDevPortalShell(
      buildDevPortalShellInput({ title: "Audit Browser", brand: "central" }),
    );
  }

  @Get("audit.json")
  async auditBrowserJson(
    @Query("action") action: string | undefined,
    @Query("resource") resource: string | undefined,
    @Query("actorUserId") actorUserId: string | undefined,
    @Query("from") from: string | undefined,
    @Query("to") to: string | undefined,
  ): Promise<AuditBrowserPageInput> {
    this.assertOperationalFeature("audit");
    const filter: AuditBrowserPageInput["filter"] = {};
    if (action) filter.action = action;
    if (resource) filter.resource = resource;
    if (actorUserId) filter.actorUserId = actorUserId;
    if (from) filter.from = from;
    if (to) filter.to = to;

    // Build the Prisma where-clause from the filter. Each predicate is
    // optional; the model's composite indexes (tenantId+createdAt /
    // targetModel+targetId / actorUserId+createdAt) handle the most
    // common pivot combinations the UI exposes.
    //
    // Iter-201: explicit `tenantId` predicate (defense-in-depth alongside RLS).
    const tenantId = requireTenantContext();
    const where: Record<string, unknown> = { tenantId };
    if (action) where.action = action.toUpperCase();
    if (resource) where.targetModel = resource;
    if (actorUserId) where.actorUserId = actorUserId;
    if (from || to) {
      const createdAt: Record<string, Date> = {};
      const fromDate = parseIsoQuery(from);
      const toDate = parseIsoQuery(to);
      if (fromDate) createdAt.gte = fromDate;
      if (toDate) createdAt.lte = toDate;
      if (Object.keys(createdAt).length > 0) where.createdAt = createdAt;
    }

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: AUDIT_BROWSER_PAGE_SIZE,
    });
    const entries: AuditLogEntry[] = rows.map((row) => mapAuditLogRow(row));
    return { entries, filter };
  }

  // ── Admin Jobs Dashboard ─────────────────────────────────────────

  /**
   * `/admin/jobs` — Admin SPA shell for the Jobs dashboard. The
   * React page re-uses the JSON contract under `/hub/jobs/*` so the
   * admin and dev surfaces stay byte-for-byte aligned. Iter-108 ships
   * the shell so site operators (Better-Auth admin role) can see
   * queue + job state without dropping into the developer portal.
   */
  @Get("jobs")
  @Header("content-type", "text/html; charset=utf-8")
  adminJobsPage(): string {
    this.assertOperationalFeature("jobs");
    return renderDevPortalShell(buildDevPortalShellInput({ title: "Jobs", brand: "central" }));
  }

  // ── Search Tester ───────────────────────────────────────────────

  @Get("search")
  @Header("content-type", "text/html; charset=utf-8")
  searchTesterPage(): string {
    this.assertOperationalFeature("search");
    return renderDevPortalShell(
      buildDevPortalShellInput({ title: "Search Tester", brand: "central" }),
    );
  }

  @Get("search.json")
  async searchTesterJson(@Query("q") q: string | undefined): Promise<SearchTesterPageInput> {
    // Tier: WORKSTATION — the tester intentionally searches ACROSS all
    // tenants (tenantId = "") to verify FTS config; on a deployed
    // surface that would be a cross-tenant data leak.
    this.assertWorkstationFeature("search");
    if (q === undefined) {
      return { hits: [] };
    }
    // SearchService is gated on `FEATURE_SEARCH_ENABLED`. Return the
    // empty-result shape when off so the SPA renders the same empty
    // state the legacy server used to render — no payload fragment
    // is trusted in either case.
    if (!this.searchService) {
      return { query: q, hits: [] };
    }
    // The search tester is a dev-only admin tool. It intentionally searches
    // across all tenants (tenantId = "" disables the member-EXISTS filter in
    // the Postgres executor) so developers can verify FTS configuration without
    // needing a specific organization context. The workstation-tier guard
    // above already pinned this to `NODE_ENV=development`.
    const rawHits = await this.searchService.search(q, {
      limit: SEARCH_TESTER_PAGE_SIZE,
      tenantId: "",
    });
    const hits: SearchTesterPageInput["hits"] = rawHits.map((hit) => ({
      resource: hit.resource,
      id: hit.id,
      title: extractSearchTitle(hit),
      // `highlight` is the cross-resource service's pre-wrapped
      // ts_headline output — the trust boundary the React page reads
      // through is documented in `search-tester-types.ts`.
      snippet: hit.highlight ?? "",
      rank: hit.rank,
    }));
    return { query: q, hits };
  }

  // ── helpers ─────────────────────────────────────────────────────

  /**
   * OPERATIONAL tier (see `hub-surface-policy.ts`): the admin SPA
   * shells and their JSON sidecars (webhooks, realtime, audit, jobs)
   * are operator-console surfaces — development-always, and outside
   * development available when `FEATURE_HUB_ENABLED=true` behind the
   * CASL wall in `HubPortalMiddleware`.
   */
  private assertOperational(): void {
    assertHubSurfaceAvailable("operational");
  }

  /**
   * WORKSTATION tier: dev tools that would undercut the permission
   * model outside a workstation (x-test-ability permission tester,
   * cross-tenant search tester). Development-only forever.
   */
  private assertWorkstation(): void {
    assertHubSurfaceAvailable("workstation");
  }

  private assertOperationalFeature(key: ToggleableFeatureKey): void {
    this.assertOperational();
    assertFeatureEnabledFromEnv(key);
  }

  private assertWorkstationFeature(key: ToggleableFeatureKey): void {
    this.assertWorkstation();
    assertFeatureEnabledFromEnv(key);
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
  if (record.isTest) entry.isTest = true;
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
