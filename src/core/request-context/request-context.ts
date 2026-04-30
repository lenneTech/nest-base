import { AsyncLocalStorage } from "node:async_hooks";

import { uuidV7 } from "../uuid/uuid-v7.js";

/**
 * Request-Context.
 *
 * Carries per-request metadata (trace-id, parent-id, sampled-flag,
 * request-id) through async boundaries via AsyncLocalStorage. Loggers,
 * exception filters, audit emitters, and downstream HTTP/DB clients
 * read from here without threading the request through every signature.
 */

export interface RequestContext {
  /**
   * Stable per-request identifier. Used as `X-Request-Id` echo and as
   * the correlation key in logs. UUID v7 = time-ordered.
   */
  requestId: string;
  traceId: string;
  parentId: string;
  sampled: boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export async function runWithRequestContext<T>(
  ctx: RequestContext,
  fn: () => Promise<T> | T,
): Promise<T> {
  return storage.run(ctx, fn);
}

/** Generate a UUID v7 request-id (time-ordered, RFC 9562). */
export function generateRequestId(): string {
  return uuidV7();
}
