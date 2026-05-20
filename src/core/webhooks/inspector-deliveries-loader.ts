/**
 * Loads webhook inspector rows from Postgres (`webhook_deliveries` +
 * `webhook_endpoints`, optional `outbox_entries` for event type).
 *
 * Pure mapping helpers are separate from the Prisma round-trip so
 * aggregations stay testable without NestJS.
 */

import type { PrismaService } from "../prisma/prisma.service.js";
import type { DeliveryAggregateInput, InspectorDeliveryStatus } from "./inspector-aggregates.js";

export interface InspectorDeliveryDbRow {
  id: string;
  endpoint_id: string;
  endpoint_url: string;
  tenant_id: string;
  event_id: string;
  event_type: string | null;
  status: string;
  status_code: number | null;
  attempt_count: number;
  last_error: string | null;
  is_test: boolean;
  occurred_at: Date;
}

export interface LoadInspectorDeliveriesInput {
  tenantId?: string;
  /** Cap rows returned (newest first). Defaults to 500. */
  limit?: number;
}

const DEFAULT_LIMIT = 500;

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isInspectorDeliveryId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function mapInspectorDeliveryRow(row: InspectorDeliveryDbRow): DeliveryAggregateInput {
  const status = normaliseDbStatus(row.status);
  const aggregate: DeliveryAggregateInput = {
    id: row.id,
    endpointId: row.endpoint_id,
    endpointUrl: row.endpoint_url,
    status,
    attemptCount: row.attempt_count,
    occurredAt: row.occurred_at.toISOString(),
    tenantId: row.tenant_id,
  };
  if (row.event_type) aggregate.eventType = row.event_type;
  if (row.status_code !== null) aggregate.statusCode = row.status_code;
  if (row.last_error) aggregate.errorMessage = row.last_error;
  if (row.is_test) aggregate.isTest = true;
  return aggregate;
}

export async function loadInspectorDeliveriesFromDb(
  prisma: PrismaService,
  input: LoadInspectorDeliveriesInput = {},
): Promise<DeliveryAggregateInput[]> {
  const limit = Math.max(1, Math.min(500, input.limit ?? DEFAULT_LIMIT));
  const tenantId = input.tenantId?.trim();

  const rows = tenantId
    ? ((await prisma.$queryRawUnsafe(
        `SELECT d.id,
                d.endpoint_id,
                e.url AS endpoint_url,
                e.tenant_id,
                d.event_id,
                o.type AS event_type,
                d.status::text AS status,
                d.status_code,
                d.attempt_count,
                d.last_error,
                d.is_test,
                d.updated_at AS occurred_at
           FROM webhook_deliveries d
           INNER JOIN webhook_endpoints e ON e.id = d.endpoint_id
           LEFT JOIN outbox_entries o ON o.id::text = d.event_id
          WHERE e.tenant_id = $1::uuid
          ORDER BY d.updated_at DESC
          LIMIT $2`,
        tenantId,
        limit,
      )) as InspectorDeliveryDbRow[])
    : ((await prisma.$queryRawUnsafe(
        `SELECT d.id,
                d.endpoint_id,
                e.url AS endpoint_url,
                e.tenant_id,
                d.event_id,
                o.type AS event_type,
                d.status::text AS status,
                d.status_code,
                d.attempt_count,
                d.last_error,
                d.is_test,
                d.updated_at AS occurred_at
           FROM webhook_deliveries d
           INNER JOIN webhook_endpoints e ON e.id = d.endpoint_id
           LEFT JOIN outbox_entries o ON o.id::text = d.event_id
          ORDER BY d.updated_at DESC
          LIMIT $1`,
        limit,
      )) as InspectorDeliveryDbRow[]);

  return rows.map(mapInspectorDeliveryRow);
}

export interface InspectorDeliveryDetailRow extends InspectorDeliveryDbRow {
  endpoint_secret: string;
}

export async function findInspectorDeliveryById(
  prisma: PrismaService,
  id: string,
  tenantId?: string,
): Promise<InspectorDeliveryDetailRow | null> {
  if (!isInspectorDeliveryId(id)) return null;
  const rows = tenantId
    ? ((await prisma.$queryRawUnsafe(
        `SELECT d.id,
                d.endpoint_id,
                e.url AS endpoint_url,
                e.secret AS endpoint_secret,
                e.tenant_id,
                d.event_id,
                o.type AS event_type,
                d.status::text AS status,
                d.status_code,
                d.attempt_count,
                d.last_error,
                d.is_test,
                d.updated_at AS occurred_at
           FROM webhook_deliveries d
           INNER JOIN webhook_endpoints e ON e.id = d.endpoint_id
           LEFT JOIN outbox_entries o ON o.id::text = d.event_id
          WHERE d.id = $1::uuid
            AND e.tenant_id = $2::uuid
          LIMIT 1`,
        id,
        tenantId,
      )) as InspectorDeliveryDetailRow[])
    : ((await prisma.$queryRawUnsafe(
        `SELECT d.id,
                d.endpoint_id,
                e.url AS endpoint_url,
                e.secret AS endpoint_secret,
                e.tenant_id,
                d.event_id,
                o.type AS event_type,
                d.status::text AS status,
                d.status_code,
                d.attempt_count,
                d.last_error,
                d.is_test,
                d.updated_at AS occurred_at
           FROM webhook_deliveries d
           INNER JOIN webhook_endpoints e ON e.id = d.endpoint_id
           LEFT JOIN outbox_entries o ON o.id::text = d.event_id
          WHERE d.id = $1::uuid
          LIMIT 1`,
        id,
      )) as InspectorDeliveryDetailRow[]);

  return rows[0] ?? null;
}

function normaliseDbStatus(value: string): InspectorDeliveryStatus {
  if (value === "DELIVERED" || value === "FAILED" || value === "PENDING") return value;
  return "PENDING";
}
