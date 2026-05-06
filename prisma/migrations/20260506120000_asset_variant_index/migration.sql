-- AssetVariantIndex (CF.STORAGE.01 final closure — iter-183).
-- Discoverable index over the AssetService variant cache. The
-- rendered bytes live on the StorageAdapter cache (`_cache/<cacheKey>`);
-- this table maps each cacheKey back to its source so cascade
-- invalidation on origin re-upload is O(log N) instead of an O(N)
-- walk over the `assets/*` prefix.
--
-- `cache_key` is the SHA-256-prefix `computeCacheKey({sourceKey,
-- options})` returns from `asset.service.ts`. `options_hash` is the
-- hash of just the `TransformOptions` — useful for analytics + dedup
-- when two sources share the same transform recipe.

CREATE TABLE "asset_variant_index" (
  "cache_key"     TEXT         NOT NULL,
  "source_key"    TEXT         NOT NULL,
  "options_hash"  TEXT         NOT NULL,
  "mime_type"     TEXT         NOT NULL,
  "size_bytes"    INTEGER      NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "asset_variant_index_pkey" PRIMARY KEY ("cache_key")
);

CREATE INDEX "asset_variant_index_source_key_idx"
  ON "asset_variant_index" ("source_key");

-- The variant index is intentionally NOT tenant-scoped: the matching
-- StorageAdapter cache is a single-prefix bucket per project (the
-- assets URL surface is public-readable by design — see CLAUDE.md
-- "Asset pipeline"). Tenant isolation rides through the storage
-- adapter's tenant-scoped key prefix when adapters use one. The
-- check:rls audit treats absence of `tenant_id` as the "not
-- tenant-scoped" branch and does not require a policy.
