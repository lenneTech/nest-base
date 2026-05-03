import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Tenant `AsyncLocalStorage` container — kept in its own file so
 * `PrismaService` (which reads from `getCurrentTenantId()` in
 * `runWithRlsTenant`) doesn't cycle-import via `TenantInterceptor`
 * (which now needs to inject PrismaService for the unified
 * resolver). Functional code lives here; the interceptor only owns
 * the request lifecycle.
 */

const tenantStorage = new AsyncLocalStorage<string>();

export function getCurrentTenantId(): string | undefined {
  return tenantStorage.getStore();
}

export async function runWithTenant<T>(tenantId: string, fn: () => Promise<T> | T): Promise<T> {
  return tenantStorage.run(tenantId, fn);
}
