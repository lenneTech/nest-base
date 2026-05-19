import { Inject, Injectable, Optional } from "@nestjs/common";

import { restrictAbilityByScopes } from "../auth/api-keys/api-key-scope-planner.js";
import { type Ability, buildAbility } from "./casl-ability.js";
import { type DbPermissionRow, resolveDbRules } from "./db-rule-resolver.js";
import { PERMISSION_STORAGE } from "./permission-storage.token.js";

/**
 * PermissionService.abilityFor().
 *
 * Loads the user's resolved Permission rows from storage, runs them
 * through the DB-Rule resolver, and caches the resulting Ability per
 * (userId, tenantId) for 60 seconds. Cache is LRU-bounded so a
 * pathological user enumeration cannot blow up memory.
 *
 * Mutating an admin's roles/policies must call `invalidate()` so the
 * next request rebuilds.
 */

export interface PermissionStorage {
  findRulesForUser(userId: string, tenantId: string): Promise<DbPermissionRow[]>;
}

export interface PermissionServiceOptions {
  /** Cache TTL in milliseconds. Default 60s. */
  ttlMs?: number;
  /** Max number of cached abilities. Default 1000. */
  maxEntries?: number;
}

export interface AbilityForOptions {
  /** When set, intersect the user's ability with these API-key scopes. */
  scopes?: readonly string[];
}

interface CacheEntry {
  ability: Ability;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 1000;

@Injectable()
export class PermissionService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(
    @Inject(PERMISSION_STORAGE) private readonly storage: PermissionStorage,
    @Optional() options: PermissionServiceOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  async abilityFor(
    userId: string,
    tenantId: string,
    options: AbilityForOptions = {},
  ): Promise<Ability> {
    const full = await this.abilityForCached(userId, tenantId);
    if (!options.scopes || options.scopes.length === 0) {
      return full;
    }
    return restrictAbilityByScopes(full, options.scopes);
  }

  private async abilityForCached(userId: string, tenantId: string): Promise<Ability> {
    const key = this.cacheKey(userId, tenantId);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      // LRU touch: re-insert to move to most-recent position.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached.ability;
    }

    const rows = await this.storage.findRulesForUser(userId, tenantId);
    // `tenantId` is forwarded to the resolver so `$CURRENT_TENANT`
    // literals in `itemFilter` substitute correctly. Without it, the
    // synthesized "Member" rules would compare `tenantId` to the
    // literal string `$CURRENT_TENANT` and never match anything.
    const rules = resolveDbRules(rows, { userId, tenantId, now: new Date() });
    const ability = buildAbility(rules);

    this.cache.set(key, { ability, expiresAt: Date.now() + this.ttlMs });
    this.evictIfNeeded();
    return ability;
  }

  /**
   * Invalidate the cache.
   *  - `invalidate(userId, tenantId)` drops the single entry
   *  - `invalidate(userId)` drops every cached entry for that user
   */
  invalidate(userId: string, tenantId?: string): void {
    if (tenantId !== undefined) {
      this.cache.delete(this.cacheKey(userId, tenantId));
      return;
    }
    // MIN-2: use the encoded prefix so userIds containing `|` are matched
    // correctly (a raw prefix like `foo|bar|` would also match unrelated
    // user `foo|bar`).
    const prefix = `${encodeURIComponent(userId)}|`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  /**
   * Drop every cached ability — the broadest invalidation. Admin
   * surfaces that mutate role/policy/permission graph (where the
   * affected user set is unknown without a graph walk) call this so
   * the next request rebuilds with fresh rules. Cheap relative to a
   * 60s TTL stale window.
   */
  invalidateAll(): void {
    this.cache.clear();
  }

  /** Cache size — used by tests + the dev-portal cache panel. */
  cacheSize(): number {
    return this.cache.size;
  }

  private cacheKey(userId: string, tenantId: string): string {
    // MIN-2: encode each component so a `|` character in userId or tenantId
    // cannot collide with the separator. Without encoding, userId="a|b" and
    // tenantId="c" would produce the same key as userId="a" and tenantId="b|c".
    return `${encodeURIComponent(userId)}|${encodeURIComponent(tenantId)}`;
  }

  private evictIfNeeded(): void {
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
