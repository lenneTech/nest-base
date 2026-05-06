/**
 * Pure planner for the "Send test event" action on the webhook inspector.
 *
 * Validates that a test dispatch is safe to proceed before the caller
 * touches the real WebhookDispatcher. No I/O, no logging — the caller
 * owns side-effects so this module stays unit-testable without a DB or
 * network.
 */

export interface WebhookTestEventInput {
  endpointId: string;
  eventType: string;
  payload?: unknown;
  knownEventTypes: readonly string[];
  endpointEnabled: boolean;
}

export type WebhookTestEventResult =
  | { ok: true }
  | { ok: false; errorCode: "UNKNOWN_EVENT_TYPE" | "ENDPOINT_DISABLED" | "INVALID_PAYLOAD" };

/**
 * Validate a pending test-event dispatch.
 *
 * Rules (evaluated in order so the most actionable error surfaces):
 *   1. Endpoint must be enabled — an operator can't send a test to an
 *      endpoint that would ignore real deliveries anyway.
 *   2. eventType must appear in `knownEventTypes` — an empty registry
 *      also fails so a misconfigured server can't silently dispatch
 *      unrecognised event names.
 */
export function planWebhookTestEvent(input: WebhookTestEventInput): WebhookTestEventResult {
  if (!input.endpointEnabled) {
    return { ok: false, errorCode: "ENDPOINT_DISABLED" };
  }

  if (
    input.knownEventTypes.length === 0 ||
    !input.knownEventTypes.includes(input.eventType)
  ) {
    return { ok: false, errorCode: "UNKNOWN_EVENT_TYPE" };
  }

  return { ok: true };
}
