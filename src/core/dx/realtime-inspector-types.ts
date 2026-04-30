/**
 * Read-model types for the `/admin/realtime` page.
 *
 * Shared between the JSON sidecar in `admin-spa.controller.ts` and the
 * React page — keeps the contract typed end-to-end.
 */

export interface ActiveSocketEntry {
  id: string;
  userId: string;
  tenantId: string;
  channels: string[];
  connectedAt: string;
}

export interface RealtimeEventEntry {
  channel: string;
  eventType: string;
  payloadPreview: string;
  occurredAt: string;
}

export interface RealtimeInspectorPageInput {
  sockets: ActiveSocketEntry[];
  events: RealtimeEventEntry[];
  refreshSeconds?: number;
}
