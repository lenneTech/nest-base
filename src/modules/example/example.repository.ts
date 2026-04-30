/**
 * Repository contract for the Example module.
 *
 * A small interface, not an inheritance base class — the service
 * depends on this shape, the module wires whichever implementation
 * is appropriate for the environment:
 *
 *   - `PrismaExampleRepository` (default) — real Postgres access via
 *     PrismaService, every query wrapped in `runWithRlsTenant()` so
 *     RLS policies enforce tenant isolation even if a WHERE clause
 *     gets forgotten.
 *   - `InMemoryExampleRepository` — fast in-process storage for
 *     unit tests and as a fallback when migrations haven't been
 *     applied yet (no DB needed to boot).
 *
 * Why an interface instead of inheriting from `BaseRepository`:
 *   - The interface is the smallest possible contract — easy to
 *     understand, easy to mock.
 *   - Keeps the example self-contained (no jump to a base class
 *     somewhere else in the tree).
 *   - Real projects can switch to BaseRepository for generic CRUD if
 *     and when that buys them more than it costs in indirection.
 */

import type { ExampleListFilter, ExampleRecord } from "./example.types.js";

export interface ExampleRepository {
  /** Insert a new record. Throws on duplicate primary key. */
  insert(record: ExampleRecord): Promise<void>;

  /**
   * Fetch by id, scoped to the supplied tenant.
   * Returns null when the record is missing OR belongs to a
   * different tenant — never throws so the service can decide the
   * right error class.
   */
  findById(tenantId: string, id: string): Promise<ExampleRecord | null>;

  /** Return every record visible to the supplied tenant, with optional filter. */
  list(tenantId: string, filter: ExampleListFilter): Promise<readonly ExampleRecord[]>;

  /**
   * Apply a partial patch and return the new record. Throws when
   * the record doesn't exist (the service catches and re-throws as
   * `ExampleNotFoundError` so HTTP layers see a consistent 404).
   */
  update(tenantId: string, id: string, patch: Partial<ExampleRecord>): Promise<ExampleRecord>;

  /** Delete by id. Returns false when the record didn't exist. */
  delete(tenantId: string, id: string): Promise<boolean>;
}
