import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, defer, from, switchMap, throwError } from 'rxjs';

import { isTenantExempt } from './tenant-guard.js';
import { parseTenantHeader } from './tenant-header.js';

/**
 * Tenant-Interceptor + AsyncLocalStorage container.
 *
 * Reads the tenant header on every inbound request and runs the rest of
 * the handler chain inside `runWithTenant()`. Domain code reads the
 * tenant via `getCurrentTenantId()` — no parameter threading. Public
 * paths (/, /health/*, /api/auth/*) are exempt.
 *
 * The Prisma extension that stamps `SET app.tenant_id = $1` on each
 * Postgres connection (added in a follow-up slice) reads from the same
 * storage so RLS policies see the right value.
 */

const tenantStorage = new AsyncLocalStorage<string>();

export function getCurrentTenantId(): string | undefined {
  return tenantStorage.getStore();
}

export async function runWithTenant<T>(tenantId: string, fn: () => Promise<T> | T): Promise<T> {
  return tenantStorage.run(tenantId, fn);
}

const TENANT_HEADER = 'x-tenant-id';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const req = context.switchToHttp().getRequest<Request>();
    const path = (req.originalUrl ?? req.url ?? '/') as string;

    if (isTenantExempt(path)) {
      return next.handle();
    }

    return defer(() => {
      const headerValue = req.headers[TENANT_HEADER];
      try {
        const tenantId = parseTenantHeader(headerValue);
        return from(runWithTenant(tenantId, () => streamToPromise(next.handle())));
      } catch (error) {
        return throwError(() => error);
      }
    }).pipe(switchMap((value) => from(unwrap(value))));
  }
}

function streamToPromise(observable: Observable<unknown>): Promise<unknown> {
  return new Promise((resolveResult, rejectResult) => {
    let last: unknown;
    observable.subscribe({
      next: (v) => {
        last = v;
      },
      error: rejectResult,
      complete: () => resolveResult(last),
    });
  });
}

function unwrap(value: unknown): Promise<unknown> {
  return Promise.resolve(value);
}
