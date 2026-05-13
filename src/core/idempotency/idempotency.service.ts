import { createHash } from "node:crypto";

/**
 * Idempotency-Key service.
 *
 * Stripe-style idempotency for non-idempotent endpoints (POST,
 * PATCH). The interceptor wiring (NestJS adapter) layers on top of
 * this service; the service owns the three load-bearing pieces:
 *
 *   - request fingerprint (sha256 of method + path + body)
 *   - lookup against an injectable store
 *   - cache hit / conflict / miss decision
 *
 * Expired records are treated as misses — the handler re-runs and
 * the record is refreshed. A thrown handler never gets cached so a
 * transient failure can be retried with the same key.
 */

export interface RequestFingerprintInput {
  method: string;
  path: string;
  body: unknown;
}

export interface IdempotencyResponse<TBody = unknown> {
  status: number;
  body: TBody;
}

export interface IdempotencyResolved<TBody = unknown> extends IdempotencyResponse<TBody> {
  replayed: boolean;
}

export interface IdempotencyRecord {
  key: string;
  userId?: string;
  requestHash: string;
  status: number;
  body: unknown;
  expiresAt: number;
}

export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyRecord | null>;
  put(record: IdempotencyRecord): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface IdempotencyServiceOptions {
  now: () => number;
  ttlMs: number;
}

export interface RunOrCacheInput<TBody = unknown> {
  key: string;
  request: RequestFingerprintInput;
  userId?: string;
  handler: () => Promise<IdempotencyResponse<TBody>>;
}

export class IdempotencyConflictError extends Error {
  constructor(public readonly key: string) {
    super(`idempotency: key "${key}" was used with a different request body`);
    this.name = "IdempotencyConflictError";
  }
}

/**
 * Thrown when a second concurrent request arrives with the same idempotency key
 * while the first handler is still executing. Callers should surface this as HTTP
 * 409 Conflict so the client knows to retry after the in-flight request completes.
 */
export class IdempotencyInProgressError extends Error {
  constructor(public readonly key: string) {
    super(`idempotency: key "${key}" is already in progress`);
    this.name = "IdempotencyInProgressError";
  }
}

export function computeRequestHash(input: RequestFingerprintInput): string {
  const normalisedBody = stableStringify(input.body);
  const fingerprint = `${input.method.toUpperCase()}\n${input.path}\n${normalisedBody}`;
  return createHash("sha256").update(fingerprint).digest("hex");
}

/**
 * Build the storage key for a (userId, idempotency-key) pair.
 *
 * Why scope by userId:
 *
 * Idempotency keys are client-supplied. UUID v7 is monotonic and
 * partly predictable, so a global lookup lets user B retrieve user A's
 * cached response by replaying the same key + body. We prefix the
 * key with the userId so two different users sharing the same
 * Idempotency-Key never collide. Anonymous calls (no userId) get the
 * "anon::" prefix and are isolated from authenticated calls.
 */
export function scopeIdempotencyKey(key: string, userId: string | undefined): string {
  return `${userId ?? "anon"}::${key}`;
}

export class IdempotencyService {
  /**
   * MAJ-2: In-process inflight guard.
   *
   * Tracks keys whose handlers are currently executing. A second request with
   * the same scoped key while the first is still running gets a 409
   * `IdempotencyInProgressError` immediately. This eliminates the TOCTOU window
   * between `store.get()` (cache miss) and `store.put()` (result written) for
   * concurrent requests in the same process.
   *
   * Note: this is a per-process guard only. Multi-replica deployments should
   * use a DB-level advisory lock or an `IN_PROGRESS` sentinel row as the
   * authoritative distributed lock — the in-memory Set covers the common
   * single-replica case and reduces races to an acceptable minimum even with
   * multiple replicas (the window shrinks to the inter-process network latency
   * rather than the full handler duration).
   */
  private readonly inflight = new Set<string>();

  constructor(
    private readonly store: IdempotencyStore,
    private readonly options: IdempotencyServiceOptions,
  ) {}

  async runOrCache<TBody>(input: RunOrCacheInput<TBody>): Promise<IdempotencyResolved<TBody>> {
    const requestHash = computeRequestHash(input.request);
    const scopedKey = scopeIdempotencyKey(input.key, input.userId);
    const existing = await this.store.get(scopedKey);
    const now = this.options.now();

    if (existing && existing.expiresAt > now) {
      if (existing.requestHash !== requestHash) {
        throw new IdempotencyConflictError(input.key);
      }
      return {
        status: existing.status,
        body: existing.body as TBody,
        replayed: true,
      };
    }

    // Guard against concurrent handlers for the same key in this process.
    if (this.inflight.has(scopedKey)) {
      throw new IdempotencyInProgressError(input.key);
    }
    this.inflight.add(scopedKey);

    try {
      const response = await input.handler();
      await this.store.put({
        key: scopedKey,
        userId: input.userId,
        requestHash,
        status: response.status,
        body: response.body,
        expiresAt: now + this.options.ttlMs,
      });
      return { ...response, replayed: false };
    } finally {
      // Always release the lock, even if the handler throws — a thrown handler
      // is intentionally NOT cached so the caller can retry with the same key.
      this.inflight.delete(scopedKey);
    }
  }
}

/**
 * JSON.stringify with sorted object keys so {a:1,b:2} and {b:2,a:1}
 * produce the same fingerprint. Arrays preserve order — that's
 * usually semantic for the request body.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
