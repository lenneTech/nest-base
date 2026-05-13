-- Restore the throttler_records_expires_at_idx that was inadvertently
-- dropped by the add-missing-indexes migration. The ThrottlerRecord
-- model uses @@ignore (Prisma does not own this table); the index was
-- created manually in the init migration and must be preserved so the
-- ThrottlerCleanupCron's time-based pruning scan stays O(log N).
CREATE INDEX IF NOT EXISTS "throttler_records_expires_at_idx"
  ON "throttler_records" ("expires_at");
