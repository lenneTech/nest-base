import { AsyncLocalStorage } from 'node:async_hooks';
import { randomFillSync } from 'node:crypto';

/**
 * Request-Context (PLAN.md §18).
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

/**
 * Generate a UUID v7 request-id. Mirrors the helper in TestHelper but
 * with no test-only baggage.
 */
export function generateRequestId(): string {
  const bytes = new Uint8Array(16);
  randomFillSync(bytes);
  const ms = BigInt(Date.now());
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex: string[] = [];
  for (const b of bytes) hex.push(b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}
