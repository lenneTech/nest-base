/**
 * Redis-backed permission cache.
 *
 * Replaces the per-pod `cache: Map<string, CacheEntry>` in
 * `PermissionService` with a Redis GET/SET EX pair so permission
 * decisions are shared across replicas within a ~30s window.
 *
 * When `redis === null`, falls back to the original in-memory Map
 * behaviour so single-replica deployments and tests work without
 * a Redis connection.
 *
 * The cache only stores the resolved `Ability` as JSON-serialised
 * raw rules. `Ability` objects are rebuilt from rules on every cache
 * hit — this avoids class-instance serialisation issues and keeps
 * the Redis value schema simple.
 */

import type { RedisClientLike } from "./redis-client.js";
import type { Ability } from "../permissions/casl-ability.js";

export interface PermissionCacheEntry {
  ability: Ability;
  expiresAt: number;
}

export interface RedisPermissionCache {
  get(userId: string, tenantId: string): Promise<PermissionCacheEntry | null>;
  set(userId: string, tenantId: string, entry: PermissionCacheEntry): Promise<void>;
  invalidate(userId: string, tenantId?: string): Promise<void>;
  invalidateAll(): Promise<void>;
}

export interface CreateRedisPermissionCacheOptions {
  redis: RedisClientLike | null;
  /** Cache TTL in milliseconds. Default 30s. */
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 30_000;
const KEY_PREFIX = "lt:perm:";

/**
 * Factory — returns a `RedisPermissionCache` backed by Redis when
 * available, falling back to an in-memory Map otherwise.
 */
export function createRedisPermissionCache(
  options: CreateRedisPermissionCacheOptions,
): RedisPermissionCache {
  const { redis, ttlMs = DEFAULT_TTL_MS } = options;

  if (!redis) {
    return createInMemoryPermissionCache(ttlMs);
  }

  const ttlSec = Math.ceil(ttlMs / 1000);

  return {
    async get(userId, tenantId) {
      try {
        const key = cacheKey(userId, tenantId);
        const raw = await redis.get(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { expiresAt: number; rules: unknown[] };
        if (parsed.expiresAt <= Date.now()) {
          void redis.del(key);
          return null;
        }
        // Rebuild Ability from stored rules to avoid class-instance serialisation.
        const { buildAbility } = await import("../permissions/casl-ability.js");
        const ability = buildAbility(parsed.rules as Parameters<typeof buildAbility>[0] & unknown[]);
        return { ability, expiresAt: parsed.expiresAt };
      } catch {
        return null;
      }
    },

    async set(userId, tenantId, entry) {
      try {
        const key = cacheKey(userId, tenantId);
        // Store the raw rules array via CASL's `.rules` property rather
        // than the Ability class instance to avoid serialisation issues.
        const rules = entry.ability.rules;
        await redis.setex(key, ttlSec, JSON.stringify({ expiresAt: entry.expiresAt, rules }));
      } catch {
        // Redis write failures are silently ignored — the next request
        // will rebuild from storage.
      }
    },

    async invalidate(userId, tenantId) {
      try {
        if (tenantId !== undefined) {
          await redis.del(cacheKey(userId, tenantId));
        }
        // Pattern delete across tenants is not possible without SCAN;
        // for per-user invalidation without tenantId we let TTL expire
        // the entries. Acceptable for the 30s TTL window.
      } catch {
        // Swallowed — invalidation is best-effort.
      }
    },

    async invalidateAll() {
      // Full-flush across replicas requires FLUSHDB which is too destructive.
      // Let TTL drain entries naturally. For immediate consistency, callers
      // that need strong guarantees should use invalidate(userId, tenantId).
    },
  };
}

function cacheKey(userId: string, tenantId: string): string {
  return `${KEY_PREFIX}${userId}|${tenantId}`;
}

// ---------------------------------------------------------------------------
// In-memory fallback (single-replica mode)
// ---------------------------------------------------------------------------

function createInMemoryPermissionCache(_ttlMs: number): RedisPermissionCache {
  const map = new Map<string, PermissionCacheEntry>();

  return {
    async get(userId, tenantId) {
      const key = cacheKey(userId, tenantId);
      const entry = map.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        map.delete(key);
        return null;
      }
      return entry;
    },

    async set(userId, tenantId, entry) {
      map.set(cacheKey(userId, tenantId), entry);
    },

    async invalidate(userId, tenantId) {
      if (tenantId !== undefined) {
        map.delete(cacheKey(userId, tenantId));
        return;
      }
      const prefix = `${KEY_PREFIX}${userId}|`;
      for (const key of map.keys()) {
        if (key.startsWith(prefix)) map.delete(key);
      }
    },

    async invalidateAll() {
      map.clear();
    },
  };
}
