import { Inject, Injectable, Logger, Module, type OnModuleInit } from "@nestjs/common";

import type { OutboxEntry } from "../outbox/outbox.js";
import { OUTBOX_DISPATCHERS, OutboxModule } from "../outbox/outbox.module.js";
import type { OutboxDispatcher } from "../outbox/outbox-worker.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { uuidV7 } from "../uuid/uuid-v7.js";
import { matchesEvent } from "./job-fanout.js";
import {
  type DeliveryRecord,
  type EndpointStatus,
  type HttpResponse,
  type WebhookDeliveryStore,
  type WebhookEndpointSnapshot,
  type WebhookEndpointStore,
  type WebhookHttpClient,
  WebhookDispatcher,
} from "./webhook-dispatcher.js";

export const WEBHOOK_HTTP_CLIENT = Symbol.for("lt:WebhookHttpClient");

/**
 * `WebhookOutboxDispatcher` (CF.WH.06+07).
 *
 * Bridges the outbox tick to the existing `WebhookDispatcher` class:
 *   1. Find every active `WebhookEndpoint` in the entry's tenant
 *      whose `events[]` pattern matches the entry's `type`
 *      (`exact`, `<group>.*`, `*`).
 *   2. For each match, route through `WebhookDispatcher.dispatch(...)`
 *      which handles HMAC signing, the per-endpoint
 *      `consecutiveFailures` watermark, the
 *      auto-disable-after-N-failures policy, and the
 *      WebhookDelivery row write.
 *
 * The HTTP client is bound via `WEBHOOK_HTTP_CLIENT` so tests can
 * inject a spy without monkey-patching `fetch`.
 *
 * Idempotency: at-least-once is the contract. The webhook receiver
 * is responsible for deduping on the `webhook-id` header (Stripe's
 * shape — also serves as the dispatcher's `eventId`).
 */
@Injectable()
export class WebhookOutboxDispatcher implements OutboxDispatcher {
  readonly name = "webhook-outbox";
  private readonly log = new Logger("WebhookOutboxDispatcher");
  private readonly endpointStore: WebhookEndpointStore;
  private readonly deliveryStore: WebhookDeliveryStore;
  private readonly innerDispatcher: WebhookDispatcher;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WEBHOOK_HTTP_CLIENT) http: WebhookHttpClient,
  ) {
    this.endpointStore = new PrismaWebhookEndpointStore(prisma);
    this.deliveryStore = new PrismaWebhookDeliveryStore(prisma);
    this.innerDispatcher = new WebhookDispatcher({
      endpointStore: this.endpointStore,
      deliveryStore: this.deliveryStore,
      http,
      now: () => Math.floor(Date.now() / 1000),
    });
  }

  async dispatch(entry: OutboxEntry): Promise<void> {
    // Walk active endpoints in the entry's tenant + filter by event-pattern.
    const endpoints = await this.findActiveSubscribers(entry.tenantId, entry.type);
    if (endpoints.length === 0) return;

    const body = JSON.stringify({
      id: entry.id,
      type: entry.type,
      occurredAt: entry.occurredAt.toISOString(),
      payload: entry.payload,
    });

    for (const endpoint of endpoints) {
      try {
        await this.innerDispatcher.dispatch({
          endpointId: endpoint.id,
          eventId: entry.id,
          eventType: entry.type,
          body,
        });
      } catch (err) {
        // Per-endpoint errors are isolated — a single failing
        // endpoint must not block sibling deliveries. The retry
        // policy + auto-disable already operate per-endpoint;
        // surfacing the error here would propagate to the worker
        // and prevent `markProcessed`. Log + continue.
        this.log.error(
          `webhook-outbox: dispatch failed for endpoint=${endpoint.id} entry=${entry.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  private async findActiveSubscribers(
    tenantId: string,
    eventType: string,
  ): Promise<readonly { id: string; events: string[] }[]> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT id, events FROM webhook_endpoints
        WHERE tenant_id = $1::uuid
          AND status = 'ACTIVE'`,
      tenantId,
    )) as Array<{ id: string; events: string[] }>;
    return rows.filter((row) => matchesEvent(row.events, eventType));
  }
}

/**
 * Prisma-backed `WebhookEndpointStore` — used by `WebhookDispatcher`
 * to read/write endpoint state during a single dispatch attempt.
 * Reads via `$queryRawUnsafe` to side-step the Nest-IoC Proxy
 * model-delegate issue (iter-84).
 */
class PrismaWebhookEndpointStore implements WebhookEndpointStore {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<WebhookEndpointSnapshot | null> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT id, tenant_id, url, secret, status, consecutive_failures
         FROM webhook_endpoints
        WHERE id = $1::uuid
        LIMIT 1`,
      id,
    )) as Array<{
      id: string;
      tenant_id: string;
      url: string;
      secret: string;
      status: EndpointStatus;
      consecutive_failures: number;
    }>;
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      url: row.url,
      secret: row.secret,
      status: row.status,
      consecutiveFailures: row.consecutive_failures,
    };
  }

  async setFailureCount(id: string, count: number): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE webhook_endpoints
          SET consecutive_failures = $1, updated_at = NOW()
        WHERE id = $2::uuid`,
      count,
      id,
    );
  }

  async disable(id: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE webhook_endpoints
          SET status = 'DISABLED', updated_at = NOW()
        WHERE id = $1::uuid`,
      id,
    );
  }
}

class PrismaWebhookDeliveryStore implements WebhookDeliveryStore {
  constructor(private readonly prisma: PrismaService) {}

  async record(delivery: DeliveryRecord): Promise<void> {
    // The dispatcher's `deliveryId()` helper composes "<endpointId>:<eventId>"
    // for in-memory dedup; the Prisma `WebhookDelivery.id` column is
    // a UUID so we mint a fresh row id here. The composite identity
    // sits in (endpoint_id, event_id) for projects that need to query
    // dispatch history.
    const rowId = uuidV7();
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO webhook_deliveries
         (id, endpoint_id, event_id, status, status_code, attempt_count, created_at, updated_at)
       VALUES
         ($1::uuid, $2::uuid, $3::text, $4::"WebhookDeliveryStatus", $5, $6, NOW(), NOW())`,
      rowId,
      delivery.endpointId,
      delivery.eventId,
      delivery.status,
      delivery.statusCode ?? null,
      delivery.attemptCount,
    );
  }
}

/**
 * Default `WebhookHttpClient` — uses native `fetch`. Tests inject a
 * spy by overriding the `WEBHOOK_HTTP_CLIENT` provider.
 */
class FetchWebhookHttpClient implements WebhookHttpClient {
  async post(url: string, body: string, headers: Record<string, string>): Promise<HttpResponse> {
    const res = await fetch(url, { method: "POST", body, headers });
    return { ok: res.ok, status: res.status };
  }
}

@Injectable()
class WebhookOutboxDispatcherLifecycle implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_DISPATCHERS) private readonly dispatchers: OutboxDispatcher[],
    private readonly dispatcher: WebhookOutboxDispatcher,
  ) {}

  /**
   * Mirrors `RealtimeOutboxDispatcherLifecycle` (iter-92) — pushes the
   * webhook dispatcher onto the shared `OUTBOX_DISPATCHERS` array at
   * module init so the OutboxWorker iterates it alongside other
   * dispatchers (realtime, search index).
   */
  onModuleInit(): void {
    if (this.dispatchers.some((d) => d.name === "webhook-outbox")) return;
    this.dispatchers.push(this.dispatcher);
  }
}

/**
 * WebhooksModule — provides the production webhook dispatcher (HMAC
 * + retry + auto-disable + Prisma-backed endpoint/delivery stores)
 * and registers it onto the `OUTBOX_DISPATCHERS` multi-provider so
 * the per-second outbox tick fans out matching events to every
 * active endpoint.
 */
@Module({
  imports: [OutboxModule],
  providers: [
    {
      provide: WEBHOOK_HTTP_CLIENT,
      useFactory: (): WebhookHttpClient => new FetchWebhookHttpClient(),
    },
    WebhookOutboxDispatcher,
    WebhookOutboxDispatcherLifecycle,
  ],
  exports: [WebhookOutboxDispatcher, WEBHOOK_HTTP_CLIENT],
})
export class WebhooksModule {}
