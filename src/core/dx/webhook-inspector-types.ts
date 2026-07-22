/**
 * Read-model types for the `/hub/admin/webhooks` page.
 *
 * The shapes are owned here (not in the dispatcher's persistence layer)
 * so the inspector view can evolve independently of the underlying
 * delivery store.
 */

import type { EndpointAggregate } from "../webhooks/inspector-aggregates.js";

export type DeliveryStatus = "DELIVERED" | "FAILED" | "PENDING";

export interface DeliveryListEntry {
  id: string;
  endpointId: string;
  endpointUrl: string;
  eventType?: string;
  status: DeliveryStatus;
  statusCode?: number;
  attemptCount: number;
  latencyMs?: number;
  occurredAt: string;
  errorMessage?: string;
  /** True when this delivery was triggered via the inspector test-event button. */
  isTest?: boolean;
}

export interface InspectorListFilter {
  status: DeliveryStatus | "ALL";
  endpointId?: string;
  eventType?: string;
  from?: string;
  to?: string;
  search?: string;
}

export interface WebhookInspectorPageInput {
  /** Up to `limit` deliveries matching the filter, newest-first. */
  deliveries: DeliveryListEntry[];
  /** Echo of the active filter (so the React page can reflect URL params). */
  filter: InspectorListFilter;
  /** Cursor for the next page; absent when no more rows. */
  nextCursor?: string;
  /** Per-request CSRF token consumed by the redeliver POST. */
  csrfToken: string;
}

export interface EndpointAggregateWithSparkline extends EndpointAggregate {
  /** 24-bucket histogram (one per hour, oldest → newest). */
  sparkline: number[];
}

export interface WebhookAggregatesResponse {
  endpoints: EndpointAggregateWithSparkline[];
}

export interface WebhookDeliveryDetailResponse {
  delivery: DeliveryListEntry & {
    /** Outbound headers the dispatcher sent (HMAC sig + webhook-id + ts). */
    requestHeaders: Record<string, string>;
    /** Outbound JSON body. Empty string when no body was sent. */
    requestBody: string;
    /** Receiver's response headers (best-effort). */
    responseHeaders?: Record<string, string>;
    responseBody?: string;
  };
  /** Single-line shell-safe curl command reproducing the request. */
  curl: string;
}

export interface WebhookRedeliverResponse {
  delivery: DeliveryListEntry;
}

export interface WebhookTestEventResponse {
  /** The delivery ID recorded in the inspector buffer for this test event. */
  deliveryId: string;
}

export interface WebhookEventTypesResponse {
  /** All event types declared via @WebhookEvent in the project registry. */
  eventTypes: string[];
}
