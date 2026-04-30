/**
 * Read-model types for the `/admin/webhooks` page.
 *
 * The shapes are owned here (not in the dispatcher's persistence layer)
 * so the inspector view can evolve independently of the underlying
 * delivery store.
 */

export type DeliveryStatus = "DELIVERED" | "FAILED";

export interface DeliveryListEntry {
  id: string;
  endpointId: string;
  eventType?: string;
  status: DeliveryStatus;
  statusCode?: number;
  attemptCount: number;
  occurredAt?: string;
  errorMessage?: string;
}

export interface WebhookInspectorPageInput {
  deliveries: DeliveryListEntry[];
  filter?: { status?: DeliveryStatus | "ALL" };
  csrfToken?: string;
}
