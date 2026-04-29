import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  Module,
  type NestInterceptor,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { type Observable, from, mergeMap } from 'rxjs';
import type { Request, Response } from 'express';

import {
  IdempotencyService,
  type IdempotencyStore,
  type IdempotencyRecord,
} from './idempotency.service.js';

const IDEMPOTENCY_STORE = Symbol.for('lt:IdempotencyStore');
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const HEADER = 'idempotency-key';
const METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly map = new Map<string, IdempotencyRecord>();
  async get(key: string) {
    return this.map.get(key) ?? null;
  }
  async put(record: IdempotencyRecord) {
    this.map.set(record.key, record);
  }
  async delete(key: string) {
    this.map.delete(key);
  }
}

@Injectable()
class IdempotencyKeyInterceptor implements NestInterceptor {
  constructor(@Inject(IdempotencyService) private readonly svc: IdempotencyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const method = (req.method ?? '').toUpperCase();
    if (!METHODS.has(method)) return next.handle();

    const key = (req.headers[HEADER] as string | undefined) ?? '';
    if (!key) return next.handle();

    return from(
      this.svc.runOrCache({
        key,
        request: { method, path: req.path ?? req.url ?? '', body: req.body },
        handler: async () => {
          const resolvedBody = await new Promise<unknown>((resolveResult, rejectResult) => {
            let last: unknown;
            next.handle().subscribe({
              next: (v) => {
                last = v;
              },
              error: rejectResult,
              complete: () => resolveResult(last),
            });
          });
          return { status: res.statusCode || 200, body: resolvedBody };
        },
      }),
    ).pipe(
      mergeMap((resolved) => {
        if (resolved.replayed) {
          res.setHeader('idempotency-replay', '1');
          res.status(resolved.status);
        }
        return [resolved.body];
      }),
    );
  }
}

/**
 * IdempotencyModule — wires `IdempotencyService` + a global
 * `APP_INTERCEPTOR` that catches non-idempotent requests carrying an
 * `Idempotency-Key` header. First request runs the handler; replays
 * with the same key+request-hash within TTL get the cached response
 * with an `Idempotency-Replay: 1` header.
 *
 * Store: in-memory by default. Postgres-backed adapter follows in a
 * separate slice once the `IdempotencyRecord` Prisma model lands.
 */
@Module({
  providers: [
    { provide: IDEMPOTENCY_STORE, useClass: InMemoryIdempotencyStore },
    {
      provide: IdempotencyService,
      useFactory: (store: IdempotencyStore) =>
        new IdempotencyService(store, { now: () => Date.now(), ttlMs: DEFAULT_TTL_MS }),
      inject: [IDEMPOTENCY_STORE],
    },
    IdempotencyKeyInterceptor,
    { provide: APP_INTERCEPTOR, useClass: IdempotencyKeyInterceptor },
  ],
  exports: [IdempotencyService, IDEMPOTENCY_STORE],
})
export class IdempotencyModule {}
