/**
 * Record ↔ Response mapping for the Example module.
 *
 * The repository hands the service `ExampleRecord` (the persisted
 * shape, including internal fields like `tenantId` and `sortValue`).
 * The HTTP layer must NOT see those — clients get a clean
 * `ExampleResponse` shape (DTO).
 *
 * Centralising the mapping in one file means:
 *   - one place to add a computed column, mask a PII field, or
 *     localize a status label
 *   - tests can verify the shape without spinning up the controller
 *   - if you ever add a different transport (e.g. a worker that
 *     serialises Example records to a webhook payload), the same
 *     mapper applies
 */

import type { CursorRecord } from "../../core/pagination/cursor.js";

import type { ExampleResponse } from "./example.dto.js";
import type { ExampleRecord } from "./example.types.js";

/** Map a stored record to the public response. Drops `tenantId`. */
export function toExampleResponse(record: ExampleRecord): ExampleResponse {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Map a stored record to a paginated row. Same fields as
 * `toExampleResponse` plus the cursor `sortValue` so
 * `buildCursorPage()` can compute `nextCursor`.
 */
export function toExampleResponseRecord(record: ExampleRecord): ExampleResponse & CursorRecord {
  return {
    ...toExampleResponse(record),
    id: record.id,
    sortValue: record.sortValue,
  };
}
