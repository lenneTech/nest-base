import { createHash } from 'node:crypto';

/**
 * Idempotency-Key service (PLAN.md §19.6 + §32 Phase 8).
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
    this.name = 'IdempotencyConflictError';
  }
}

export function computeRequestHash(input: RequestFingerprintInput): string {
  const normalisedBody = stableStringify(input.body);
  const fingerprint = `${input.method.toUpperCase()}\n${input.path}\n${normalisedBody}`;
  return createHash('sha256').update(fingerprint).digest('hex');
}

export class IdempotencyService {
  constructor(
    private readonly store: IdempotencyStore,
    private readonly options: IdempotencyServiceOptions,
  ) {}

  async runOrCache<TBody>(input: RunOrCacheInput<TBody>): Promise<IdempotencyResolved<TBody>> {
    const requestHash = computeRequestHash(input.request);
    const existing = await this.store.get(input.key);
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

    const response = await input.handler();
    await this.store.put({
      key: input.key,
      userId: input.userId,
      requestHash,
      status: response.status,
      body: response.body,
      expiresAt: now + this.options.ttlMs,
    });
    return { ...response, replayed: false };
  }
}

/**
 * JSON.stringify with sorted object keys so {a:1,b:2} and {b:2,a:1}
 * produce the same fingerprint. Arrays preserve order — that's
 * usually semantic for the request body.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}
