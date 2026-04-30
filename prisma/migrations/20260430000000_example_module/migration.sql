-- Example module reference table.
--
-- Backs the `src/modules/example/` reference implementation. Real
-- projects rename this table (and the matching Prisma model) to
-- whatever the actual resource is called.
--
-- The shape mirrors the in-memory record in `example.types.ts`:
--   id, tenantId, name, description, status, createdAt, updatedAt
--
-- RLS is enabled with the same one-policy pattern every other
-- tenant-scoped table uses: rows are visible iff `tenant_id`
-- matches the session-local `app.tenant_id` set by the Prisma
-- extension via `runWithRlsTenant()`.

CREATE TABLE examples (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   UUID         NOT NULL,
  name        TEXT         NOT NULL,
  description TEXT,
  status      TEXT         NOT NULL DEFAULT 'draft',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX examples_tenant_id_idx ON examples (tenant_id);

ALTER TABLE examples ENABLE ROW LEVEL SECURITY;

CREATE POLICY examples_tenant_isolation ON examples
  USING (tenant_id::text = current_setting('app.tenant_id', true));
