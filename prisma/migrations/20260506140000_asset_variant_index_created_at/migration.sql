-- AssetVariantIndex createdAt index (CF.STORAGE.01 follow-up — iter-185).
-- The `VariantCacheCleanupCron` filters on `createdAt < cutoff` to
-- prune orphan rows older than the 90-day retention window. Without
-- this index the deleteMany scans sequentially; once the index ships
-- the prune is O(log N) on row count.
--
-- Schema source of truth: `@@index([createdAt])` on `AssetVariantIndex`
-- in `prisma/schema.prisma`.

CREATE INDEX "asset_variant_index_created_at_idx"
  ON "asset_variant_index" ("created_at");
