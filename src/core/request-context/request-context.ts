import { AsyncLocalStorage } from "node:async_hooks";

import { uuidV7 } from "../uuid/uuid-v7.js";

/**
 * Request-Context.
 *
 * Carries per-request metadata (trace-id, parent-id, sampled-flag,
 * request-id, userId) through async boundaries via AsyncLocalStorage.
 * Loggers, exception filters, audit emitters, and downstream HTTP/DB
 * clients read from here without threading the request through every
 * signature.
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
   * Authenticated user id — populated by `BetterAuthSessionMiddleware`
   * after session resolution. `undefined` for anonymous / public requests.
   */
  userId?: string;
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

/**
 * Returns the authenticated user id from the current request context, or
 * `undefined` when called outside a request scope or on anonymous requests.
 *
 * Mirrors `getCurrentTenantId()` — both read a field the session middleware
 * stamps on the shared `RequestContext` store so downstream services never
 * need the user id threaded through their signatures.
 */
export function getCurrentUserId(): string | undefined {
  return storage.getStore()?.userId;
}

/**
 * Stamps the authenticated user id onto the running request context.
 *
 * Called by `BetterAuthSessionMiddleware` after session resolution. The
 * context object is a plain mutable reference; mutating it in-place
 * propagates to every async continuation already inside the same
 * `AsyncLocalStorage` run without needing to re-enter the store.
 *
 * Safe to call with `undefined` — anonymous requests leave `userId`
 * unset rather than storing `undefined` explicitly.
 */
export function setCurrentUserId(userId: string | undefined): void {
  const ctx = storage.getStore();
  if (ctx && userId !== undefined) {
    ctx.userId = userId;
  }
}

/** Generate a UUID v7 request-id (time-ordered, RFC 9562). */
export function generateRequestId(): string {
  return uuidV7();
}
