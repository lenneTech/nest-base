-- PowerSync replication bootstrap.
--
-- Creates a dedicated `powersync` role with REPLICATION + LOGIN attributes
-- and a logical publication PowerSync subscribes to. Both are guarded so
-- the migration is safe to re-run (idempotent on fresh + existing DBs).
--
-- The actual password is set by the runtime (the seed script reads
-- POWERSYNC_DB_PASSWORD and runs ALTER ROLE) — committing a real
-- secret here would leak it into history.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powersync') THEN
    CREATE ROLE powersync WITH REPLICATION LOGIN PASSWORD 'change-me-at-runtime';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync') THEN
    -- FOR ALL TABLES is broad on purpose — sync-rules.yaml does the
    -- per-table allowlisting at the PowerSync layer. Tables that must
    -- never reach a mobile client (audit logs, raw secrets, encrypted
    -- columns) are excluded by the sync rules, not by the publication.
    CREATE PUBLICATION powersync FOR ALL TABLES;
  END IF;
END
$$;

-- The role only needs read access; writes go through the
-- /powersync/crud Upload-Controller, which runs as the application user.
GRANT USAGE ON SCHEMA public TO powersync;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync;
