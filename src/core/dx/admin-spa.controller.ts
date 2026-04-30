import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Post,
  Query,
} from "@nestjs/common";

import { type AuditBrowserPageInput, type AuditLogEntry } from "./audit-browser-types.js";
import { buildDevPortalShellInput, renderDevPortalShell } from "./dev-portal-shell.js";
import { type RealtimeInspectorPageInput } from "./realtime-inspector-types.js";
import { type SearchTesterPageInput } from "./search-tester-types.js";
import { type WebhookInspectorPageInput } from "./webhook-inspector-types.js";
import { serverConfigFromEnv } from "../server/server-config.js";
import { buildPermissionReport, type PermissionReport } from "../permissions/permission-report.js";

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
 * Data sources are stub-empty for now (the underlying registries —
 * webhook deliveries, audit log, active sockets, permission storage —
 * are not yet wired up). The pages render with empty results and a
 * "no data yet" hint, mirroring the legacy `*-ui.ts` behaviour.
 */
@Controller("admin")
export class AdminSpaController {
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
  webhookInspectorJson(@Query("status") status: string | undefined): WebhookInspectorPageInput {
    this.assertDev();
    const filterStatus = normaliseDeliveryStatus(status);
    return { deliveries: [], filter: { status: filterStatus } };
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
    return { sockets: [], events: [] };
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

  /**
   * Echo endpoint mirroring the legacy POST-redeliver action — the
   * legacy server never persisted webhooks, so we return a 400 to make
   * the absence of a delivery store explicit. React keeps the redeliver
   * button disabled when there are no rows.
   */
  @Post("webhooks/:id/redeliver")
  redeliverWebhook(@Body() _body: unknown): never {
    this.assertDev();
    throw new BadRequestException("webhook delivery store not wired yet");
  }

  private assertDev(): void {
    const cfg = serverConfigFromEnv(process.env);
    if (cfg.env !== "development") {
      throw new NotFoundException();
    }
  }
}

function normaliseDeliveryStatus(value: string | undefined): "ALL" | "DELIVERED" | "FAILED" {
  if (value === "DELIVERED" || value === "FAILED") return value;
  return "ALL";
}
