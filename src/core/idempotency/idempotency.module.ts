import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  Module,
  type NestInterceptor,
} from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { type Observable, from, mergeMap } from "rxjs";
import type { Request, Response } from "express";

import { PrismaService } from "../prisma/prisma.service.js";
import {
  IdempotencyCleanupCron,
  InMemoryIdempotencyStoreWithCleanup,
} from "./idempotency-cleanup.js";
import { IdempotencyService, type IdempotencyStore } from "./idempotency.service.js";
import {
  PrismaIdempotencyStore,
  hasPrismaIdempotencyDelegate,
} from "./idempotency-store.prisma.js";

const IDEMPOTENCY_STORE = Symbol.for("lt:IdempotencyStore");
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const HEADER = "idempotency-key";
const METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

@Injectable()
class IdempotencyKeyInterceptor implements NestInterceptor {
  constructor(@Inject(IdempotencyService) private readonly svc: IdempotencyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const req = context.switchToHttp().getRequest<Request & { user?: { id?: string } }>();
    const res = context.switchToHttp().getResponse<Response>();

    const method = (req.method ?? "").toUpperCase();
    if (!METHODS.has(method)) return next.handle();

    const key = (req.headers[HEADER] as string | undefined) ?? "";
    if (!key) return next.handle();

    // Scope by userId to prevent cross-user replay: see
    // `scopeIdempotencyKey` in idempotency.service.ts. `req.user.id`
    // is set by the Better-Auth middleware before any interceptor runs.
    const userId = req.user?.id;

    return from(
      this.svc.runOrCache({
        key,
        ...(userId ? { userId } : {}),
        request: { method, path: req.path ?? req.url ?? "", body: req.body },
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
          res.setHeader("idempotency-replay", "1");
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
 * Store selection (iter-179 — CF.STORAGE.01 closure): the factory
 * picks `PrismaIdempotencyStore` when the resolved Prisma client
 * exposes the `idempotencyRecord` delegate (the migration shipped
 * in `prisma/migrations/20260506100000_idempotency_records/`).
 * Tests that flip features at runtime without regenerating the
 * Prisma client land in the in-memory fallback. The runtime detection
 * keeps the boot path independent of CI's Prisma-generation timing.
 */
@Module({
  providers: [
    {
      provide: IDEMPOTENCY_STORE,
      useFactory: (prisma: PrismaService): IdempotencyStore => {
        if (!hasPrismaIdempotencyDelegate(prisma)) return new InMemoryIdempotencyStoreWithCleanup();
        return new PrismaIdempotencyStore(prisma);
      },
      inject: [PrismaService],
    },
    {
      provide: IdempotencyService,
      useFactory: (store: IdempotencyStore) =>
        new IdempotencyService(store, { now: () => Date.now(), ttlMs: DEFAULT_TTL_MS }),
      inject: [IDEMPOTENCY_STORE],
    },
    // APP_INTERCEPTOR binding creates the global instance — no plain
    // provider needed; a second registration would create a duplicate
    // instance and run the interceptor twice per request (H2 fix).
    { provide: APP_INTERCEPTOR, useClass: IdempotencyKeyInterceptor },
    // Iter-181: periodic prune of expired idempotency_records.
    // The `expiresAt` index from migration 20260506100000 makes the
    // delete O(log N). Both adapters implement deleteOlderThan, so
    // the cron does real work in either binding (Prisma deleteMany
    // or in-memory Map prune).
    IdempotencyCleanupCron,
  ],
  exports: [IdempotencyService, IDEMPOTENCY_STORE],
})
export class IdempotencyModule {}
