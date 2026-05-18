import { buildHmacSignatureHeader } from "./hmac-signature.js";
import { type RetryConfig, WEBHOOK_RETRY_DEFAULTS, shouldAutoDisable } from "./retry-policy.js";
import { getRegisteredWebhookEvents } from "./webhook-event.decorator.js";
import { InvalidWebhookUrlError, validateWebhookUrl } from "./webhook-url-validator.js";

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
  /** Optional logger for surfacing HTTP dispatch errors (MAJ-5). */
  logger?: { error(obj: Record<string, unknown>, msg: string): void };
}

export class WebhookEndpointNotFoundError extends Error {
  constructor(id: string) {
    super(`webhook endpoint not found: ${id}`);
    this.name = "WebhookEndpointNotFoundError";
  }
}

/**
 * Thrown when `WebhookDispatcher.dispatch()` receives an `eventType`
 * that isn't declared via `@WebhookEvent`. The dispatcher consults
 * `getRegisteredWebhookEvents()`; when that registry is non-empty
 * (i.e. the project has at least one declared event), unknown event
 * names are rejected loudly so a typo can't silently dispatch a
 * non-canonical event. Empty registry = backward-compat: the
 * dispatcher accepts any event type so the slice's introduction
 * doesn't break consumers that haven't yet declared events.
 */
export class WebhookEventTypeNotRegisteredError extends Error {
  constructor(
    public readonly eventType: string,
    public readonly availableTypes: readonly string[],
  ) {
    super(
      `webhook dispatcher: eventType "${eventType}" is not declared via @WebhookEvent ` +
        `(declared: ${availableTypes.length === 0 ? "<none>" : availableTypes.join(", ")})`,
    );
    this.name = "WebhookEventTypeNotRegisteredError";
  }
}

export class WebhookDispatcher {
  private readonly retry: RetryConfig;

  constructor(private readonly options: WebhookDispatcherOptions) {
    this.retry = options.retry ?? WEBHOOK_RETRY_DEFAULTS;
  }

  async dispatch(input: DispatchInput): Promise<void> {
    // Validate eventType against the @WebhookEvent registry. Skip
    // when the registry is empty (no events declared yet — projects
    // adopt the decorator at their own pace + we don't want a
    // backwards-incompat behaviour change to fire on day one).
    const registered = getRegisteredWebhookEvents();
    if (registered.length > 0) {
      const found = registered.some((meta) => meta.name === input.eventType);
      if (!found) {
        throw new WebhookEventTypeNotRegisteredError(
          input.eventType,
          registered.map((m) => m.name),
        );
      }
    }

    const endpoint = await this.options.endpointStore.findById(input.endpointId);
    if (!endpoint) throw new WebhookEndpointNotFoundError(input.endpointId);
    if (endpoint.status === "DISABLED") return;

    // CRIT-3: block SSRF by validating the endpoint URL before the HTTP call.
    // An invalid URL marks the delivery as FAILED and disables the endpoint so
    // the misconfiguration surfaces in the admin UI without repeated attempts.
    try {
      validateWebhookUrl(endpoint.url);
    } catch (err) {
      if (err instanceof InvalidWebhookUrlError) {
        const nextFailures = endpoint.consecutiveFailures + 1;
        await this.options.endpointStore.setFailureCount(endpoint.id, nextFailures);
        if (shouldAutoDisable(nextFailures, this.retry)) {
          await this.options.endpointStore.disable(endpoint.id);
        }
        await this.options.deliveryStore.record({
          id: deliveryId(input),
          endpointId: endpoint.id,
          eventId: input.eventId,
          status: "FAILED",
          attemptCount: 1,
        });
        return;
      }
      throw err;
    }

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
    // MIN-1: disable() before record() to close the TOCTOU window where the
    // endpoint appears enabled between the record() write and the subsequent
    // disable(). Any concurrent fanout that reads the endpoint between those
    // two calls would see it as still active. Disabling first is the safer
    // order — a delivery record for an already-disabled endpoint is harmless.
    if (shouldAutoDisable(nextFailures, this.retry)) {
      await this.options.endpointStore.disable(endpoint.id);
    }
    await this.options.deliveryStore.record({
      id: deliveryId(input),
      endpointId: endpoint.id,
      eventId: input.eventId,
      status: "FAILED",
      ...(response ? { statusCode: response.status } : {}),
      attemptCount: 1,
    });
    // MAJ-5: log HTTP dispatch errors so on-call alerts can fire.
    // The empty block was a silent failure — every network error was swallowed.
    if (httpError) {
      this.options.logger?.error(
        {
          endpointId: endpoint.id,
          url: endpoint.url,
          error: httpError.message,
        },
        "webhook: HTTP dispatch failed",
      );
    }
  }
}

function deliveryId(input: DispatchInput): string {
  return `${input.endpointId}::${input.eventId}`;
}
