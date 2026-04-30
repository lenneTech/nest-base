/**
 * Internal types for the Example module.
 *
 * These describe the *domain shape* — what an Example record looks
 * like inside the service / repository layer. They are deliberately
 * separate from the DTOs (`example.dto.ts`) which describe what the
 * HTTP wire sees: DTOs validate input and shape output, types model
 * the persistent data.
 *
 * Keeping them in their own file means a downstream copy of this
 * module can grow new fields, computed columns, or internal flags
 * without touching the DTO file.
 */

import type { CursorRecord } from "../../core/pagination/cursor.js";

/** Lifecycle of an Example record. */
export type ExampleStatus = "draft" | "published" | "archived";

/**
 * The persisted shape — every column the storage layer reads or
 * writes. Extends `CursorRecord` so the pagination helper can sort
 * + slice without the service having to project the field manually.
 */
export interface ExampleRecord extends CursorRecord {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: ExampleStatus;
  createdAt: string;
  updatedAt: string;
}

/** Filter envelope used by `ExampleRepository.list()`. */
export interface ExampleListFilter {
  status?: ExampleStatus;
}
