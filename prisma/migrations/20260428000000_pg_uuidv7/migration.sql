-- Install the pg_uuidv7 extension (PLAN.md §31).
-- Provides `uuid_generate_v7()` so column defaults stay time-ordered
-- without depending on application-side ID minting.
--
-- The extension binary must be present on the Postgres image; vanilla
-- `postgres:18-alpine` does NOT bundle it. Use a Postgres image that
-- packages pg_uuidv7 (e.g. `tembo-io/pg_uuidv7`, `kibae/postgres-pg_uuidv7`)
-- or compile/install the extension on your DB host before running this
-- migration. Local dev: `docker-compose.yml` Postgres image is the
-- override point.

CREATE EXTENSION IF NOT EXISTS pg_uuidv7;
