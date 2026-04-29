import { Injectable, Logger, Module } from "@nestjs/common";

import type { OutboxEntry } from "../outbox/outbox.js";
import type { OutboxDispatcher } from "../outbox/outbox-worker.js";

/**
 * Subscribes to outbox entries, looks up matching `WebhookEndpoint`
 * rows, and POSTs the payload with HMAC signature + retry policy.
 *
 * Today: log-only stub so the chain is wired and observable. Real
 * delivery hooks into the existing `WebhookDispatcher` class once
 * `WebhookEndpointStore`/`WebhookDeliveryStore` Prisma adapters are
 * registered (Phase 5 follow-up).
 *
 * Wiring: app modules that want webhook fan-out append this provider
 * to their own `OUTBOX_DISPATCHERS`-bound list. A future iteration
 * adds a `DiscoveryService`-driven auto-collection so domain modules
 * just `@Injectable()` their dispatcher and it joins the list.
 */
@Injectable()
export class WebhookOutboxDispatcher implements OutboxDispatcher {
  readonly name = "webhook";
  private readonly logger = new Logger("WebhookDispatcher");

  async dispatch(entry: OutboxEntry): Promise<void> {
    this.logger.log(`outbox→webhook: ${entry.type} (id=${entry.id} tenant=${entry.tenantId})`);
  }
}

/**
 * WebhooksModule — provides `WebhookOutboxDispatcher` (the outbox
 * subscriber). Real HMAC-signed HTTP POST + retry/auto-disable
 * happens in the underlying `WebhookDispatcher` class once the
 * endpoint/delivery Prisma stores are bound.
 */
@Module({
  providers: [WebhookOutboxDispatcher],
  exports: [WebhookOutboxDispatcher],
})
export class WebhooksModule {}
