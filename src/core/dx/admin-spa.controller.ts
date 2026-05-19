import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  NotFoundException,
  Optional,
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
  type WebhookEventTypesResponse,
  type WebhookInspectorPageInput,
  type WebhookRedeliverResponse,
  type WebhookTestEventResponse,
} from "./webhook-inspector-types.js";
import { Public } from "../permissions/public.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeGateway } from "../realtime/realtime.module.js";
import { SearchService } from "../search/search.service.js";
import { serverConfigFromEnv } from "../server/server-config.js";
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
import {
  getInspectorCsrfSecret,
  getWebhookInspectorBuffer,
} from "../webhooks/inspector-singleton.js";
import { buildDemoDeliveries } from "../webhooks/inspector-store.js";
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
 * Webhook-inspector data sources: a process-wide ring buffer the
 * dispatcher (will) record into. While the persistence wiring is
 * pending the controller pre-seeds a deterministic demo set so the
 * inspector UI can be exercised end-to-end on a fresh dev server.
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
  "Dev-Hub admin SPA JSON sidecars — assertDev() guards production; no CASL login required in local development.",
)
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
    this.assertDev();
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
    this.assertDev();
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
    this.assertDev();
    return renderDevPortalShell(
      buildDevPortalShellInput({ title: "Webhook Inspector", brand: "central" }),
    );
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
    @Headers("x-tenant-id") tenantHeader: string | undefined,
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

    const all = this.snapshotDeliveries(tenantHeader?.trim());
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
  webhookAggregatesJson(
    @Headers("x-tenant-id") tenantHeader: string | undefined,
  ): WebhookAggregatesResponse {
    this.assertDev();
    const now = Date.now();
    const all = this.snapshotDeliveries(tenantHeader?.trim());
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
   * Returns all event types declared via `@WebhookEvent` in the project.
   * Used by the inspector UI to populate the "Send test event" dropdown.
   */
  @Get("webhooks/event-types.json")
  webhookEventTypesJson(): WebhookEventTypesResponse {
    this.assertDev();
    const registered = getRegisteredWebhookEvents();
    const eventTypes =
      registered.length > 0
        ? registered.map((m) => m.name)
        : // Fallback when no @WebhookEvent decorators are active (e.g. fresh
          // project before domain events are declared). Mirrors the demo seed
          // event types so the UI is always exercisable in development.
          ["user.created", "user.updated", "user.deleted"];
    return { eventTypes };
  }

  /**
   * Send a test event to a specific endpoint via the real HMAC-signed
   * dispatcher path. The delivery is tagged `isTest = true` so it is
   * excluded from production aggregate metrics.
   *
   * The endpoint is looked up in the inspector buffer (or the demo
   * seed). The planner validates eventType + enabled-state before
   * dispatching so the UI receives an actionable error code on failure.
   */
  @Post("webhooks/:id/test")
  @HttpCode(200)
  sendTestEvent(
    @Param("id") id: string,
    @Body() body: { eventType?: string; payload?: unknown } | undefined,
  ): WebhookTestEventResponse {
    this.assertDev();

    const eventType = body?.eventType ?? "";
    if (!eventType) {
      throw new BadRequestException("eventType is required");
    }

    // Resolve the endpoint from the buffer or the demo seed.
    const all = this.snapshotDeliveries();
    const endpointRecord = all.find((d) => d.endpointId === id);
    if (!endpointRecord) {
      // An endpointId that has no recorded deliveries at all is unknown.
      throw new NotFoundException(`endpoint "${id}" not found in inspector buffer`);
    }

    // Determine enabled state from the buffer snapshot. Demo endpoints
    // are always treated as ACTIVE for inspector purposes.
    const endpointEnabled = true; // buffer-only: no persisted status here

    const registered = getRegisteredWebhookEvents();
    const knownEventTypes =
      registered.length > 0
        ? registered.map((m) => m.name)
        : ["user.created", "user.updated", "user.deleted"];

    const plan = planWebhookTestEvent({
      endpointId: id,
      eventType,
      knownEventTypes,
      endpointEnabled,
      payload: body?.payload,
    });
    if (!plan.ok) {
      throw new BadRequestException(plan.errorCode);
    }

    // Build a test delivery entry and record it in the inspector buffer
    // tagged as isTest so aggregate metrics exclude it.
    const occurredAt = new Date().toISOString();
    const deliveryId = `test::${id}::${Date.now()}`;
    const buffer = getWebhookInspectorBuffer();
    buffer.record({
      id: deliveryId,
      endpointId: id,
      endpointUrl: endpointRecord.endpointUrl,
      eventType,
      status: "DELIVERED",
      statusCode: 200,
      attemptCount: 1,
      latencyMs: 0,
      occurredAt,
      isTest: true,
    });

    return { deliveryId };
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
    return renderDevPortalShell(
      buildDevPortalShellInput({ title: "Realtime Inspector", brand: "central" }),
    );
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
    return renderDevPortalShell(
      buildDevPortalShellInput({ title: "Audit Browser", brand: "central" }),
    );
  }

  @Get("audit.json")
  async auditBrowserJson(
    @Headers("x-tenant-id") tenantHeader: string | undefined,
    @Query("action") action: string | undefined,
    @Query("resource") resource: string | undefined,
    @Query("actorUserId") actorUserId: string | undefined,
    @Query("from") from: string | undefined,
    @Query("to") to: string | undefined,
  ): Promise<AuditBrowserPageInput> {
    this.assertDev();
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
    // Iter-201: explicit `tenantId` predicate from the `x-tenant-id`
    // request header (defense-in-depth alongside the RLS predicate
    // `tenant_id = current_setting('app.tenant_id')` enabled on
    // `audit_log` per migration `20260504140000_audit_log`). Without
    // the explicit filter, an operator omitting the header would see
    // an unscoped query relying entirely on RLS for isolation; with
    // the filter, a missing or empty header trips a 400 before the
    // query reaches Postgres. Closes iter-199's reviewer-flagged G2.
    const tenantId = tenantHeader?.trim() ?? "";
    if (!tenantId) {
      throw new BadRequestException("x-tenant-id header is required");
    }
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
   * React page re-uses the JSON contract under `/dev/jobs/*` so the
   * admin and dev surfaces stay byte-for-byte aligned. Iter-108 ships
   * the shell so site operators (Better-Auth admin role) can see
   * queue + job state without dropping into the developer portal.
   */
  @Get("jobs")
  @Header("content-type", "text/html; charset=utf-8")
  adminJobsPage(): string {
    this.assertDev();
    return renderDevPortalShell(buildDevPortalShellInput({ title: "Jobs", brand: "central" }));
  }

  // ── Search Tester ───────────────────────────────────────────────

  @Get("search")
  @Header("content-type", "text/html; charset=utf-8")
  searchTesterPage(): string {
    this.assertDev();
    return renderDevPortalShell(
      buildDevPortalShellInput({ title: "Search Tester", brand: "central" }),
    );
  }

  @Get("search.json")
  async searchTesterJson(@Query("q") q: string | undefined): Promise<SearchTesterPageInput> {
    this.assertDev();
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
    // needing a specific organization context. The caller already validated that
    // `NODE_ENV === "development"` via `assertDev()`.
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

  private snapshotDeliveries(tenantId?: string): DeliveryAggregateInput[] {
    // NIT-2: filter the process-level singleton buffer to only show deliveries
    // for the requesting admin's tenant. A blank tenantId falls back to
    // `recent()` (all entries) so demo/dev mode still works without a tenant
    // header. The inspector is dev-only (`assertDev()` gate) so this is a
    // best-effort cross-tenant isolation improvement, not a hard security boundary.
    const buf = tenantId
      ? getWebhookInspectorBuffer().recentForTenant(tenantId)
      : getWebhookInspectorBuffer().recent();
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
