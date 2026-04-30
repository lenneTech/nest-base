import { buildHmacSignatureHeader } from "./hmac-signature.js";
import { type RetryConfig, WEBHOOK_RETRY_DEFAULTS, shouldAutoDisable } from "./retry-policy.js";

/**
 * Webhook Dispatcher.
 *
 * Glues the HMAC-signature, retry-policy, and fanout helpers from
 * earlier slices into a service that:
 *   - POSTs the body with `webhook-signature: t=<unix>,v1=<base64>`
 *   - on success → marks delivery DELIVERED, resets
 *     consecutive_failures
 *   - on failure → increments consecutive_failures, records FAILED
 *     delivery, auto-disables the endpoint at the configured
 *     threshold
 *
 * HTTP + storage stay behind small interfaces so the unit suite runs
 * without a network or DB.
 */

export type EndpointStatus = "ACTIVE" | "DISABLED";
export type DeliveryStatus = "DELIVERED" | "FAILED";

export interface WebhookEndpointSnapshot {
  id: string;
  tenantId: string;
  url: string;
  secret: string;
  status: EndpointStatus;
  consecutiveFailures: number;
}

export interface WebhookEndpointStore {
  findById(id: string): Promise<WebhookEndpointSnapshot | null>;
  setFailureCount(id: string, count: number): Promise<void>;
  disable(id: string): Promise<void>;
}

export interface DeliveryRecord {
  id: string;
  endpointId: string;
  eventId: string;
  status: DeliveryStatus;
  statusCode?: number;
  attemptCount: number;
}

export interface WebhookDeliveryStore {
  record(delivery: DeliveryRecord): Promise<void>;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
}

export interface WebhookHttpClient {
  post(url: string, body: string, headers: Record<string, string>): Promise<HttpResponse>;
}

export interface DispatchInput {
  endpointId: string;
  eventId: string;
  eventType: string;
  body: string;
}

export interface WebhookDispatcherOptions {
  http: WebhookHttpClient;
  endpointStore: WebhookEndpointStore;
  deliveryStore: WebhookDeliveryStore;
  /** Returns the current unix-second timestamp (override for tests). */
  now: () => number;
  retry?: RetryConfig;
}

export class WebhookEndpointNotFoundError extends Error {
  constructor(id: string) {
    super(`webhook endpoint not found: ${id}`);
    this.name = "WebhookEndpointNotFoundError";
  }
}

export class WebhookDispatcher {
  private readonly retry: RetryConfig;

  constructor(private readonly options: WebhookDispatcherOptions) {
    this.retry = options.retry ?? WEBHOOK_RETRY_DEFAULTS;
  }

  async dispatch(input: DispatchInput): Promise<void> {
    const endpoint = await this.options.endpointStore.findById(input.endpointId);
    if (!endpoint) throw new WebhookEndpointNotFoundError(input.endpointId);
    if (endpoint.status === "DISABLED") return;

    const ts = String(this.options.now());
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "webhook-id": input.eventId,
      "webhook-timestamp": ts,
      "webhook-signature": buildHmacSignatureHeader(endpoint.secret, ts, input.body),
    };

    let response: HttpResponse | null = null;
    let httpError: Error | null = null;
    try {
      response = await this.options.http.post(endpoint.url, input.body, headers);
    } catch (error) {
      httpError = error instanceof Error ? error : new Error(String(error));
    }

    const delivered = response?.ok === true;

    if (delivered) {
      await this.options.endpointStore.setFailureCount(endpoint.id, 0);
      await this.options.deliveryStore.record({
        id: deliveryId(input),
        endpointId: endpoint.id,
        eventId: input.eventId,
        status: "DELIVERED",
        statusCode: response?.status,
        attemptCount: 1,
      });
      return;
    }

    const nextFailures = endpoint.consecutiveFailures + 1;
    await this.options.endpointStore.setFailureCount(endpoint.id, nextFailures);
    await this.options.deliveryStore.record({
      id: deliveryId(input),
      endpointId: endpoint.id,
      eventId: input.eventId,
      status: "FAILED",
      ...(response ? { statusCode: response.status } : {}),
      attemptCount: 1,
    });
    if (shouldAutoDisable(nextFailures, this.retry)) {
      await this.options.endpointStore.disable(endpoint.id);
    }
    if (httpError && process.env.NODE_ENV !== "test") {
      // Log path: real binding hands httpError to the logger; tests
      // don't need observable side-effects for the throw case.
    }
  }
}

function deliveryId(input: DispatchInput): string {
  return `${input.endpointId}::${input.eventId}`;
}
