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
  /**
   * Authenticated user id for the current request. Set by
   * `BetterAuthSessionMiddleware` after the session is resolved.
   * Undefined for anonymous or unauthenticated requests.
   * Used by the audit extension to attribute `actorUserId` on every
   * mutation without threading `userId` through every signature.
   */
  userId?: string;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/**
 * Run `fn` inside the request context `ctx`. The callback can be either
 * synchronous or asynchronous — `AsyncLocalStorage.run()` is synchronous
 * itself, so all async continuations that originate inside `fn` share the
 * same context without any wrapping `async`.
 *
 * Prefer calling `requestContextStorage.run(ctx, fn)` directly in the
 * Express middleware layer so the context is set synchronously before
 * `next()` is called (MAJ-3 fix).
 */
export async function runWithRequestContext<T>(
  ctx: RequestContext,
  fn: () => Promise<T> | T,
): Promise<T> {
  return requestContextStorage.run(ctx, fn);
}

/** Generate a UUID v7 request-id (time-ordered, RFC 9562). */
export function generateRequestId(): string {
  return uuidV7();
}
