/**
 * Email-Outbox Admin Action Planner (issue #91).
 *
 * Pure state-machine helpers consumed by `EmailOutboxAdminController`.
 * No DB calls — the controller passes the current record status and
 * the planner returns a decision so the controller can execute the
 * appropriate storage mutation (or throw ForbiddenException).
 *
 * State-transition rules mirror the issue #91 acceptance criteria:
 *
 *   RETRY  — allowed when status is `pending` or `dead-letter`.
 *             Forbidden when `sent` or `cancelled`.
 *             (In-flight = `pending` with a fresh `claimedAt`;
 *              the planner treats this the same as `pending` —
 *              the worker claim-safety prevents double-dispatch.)
 *
 *   CANCEL — allowed when status is `pending` or `dead-letter`.
 *             Forbidden when `sent` or `cancelled`.
 *
 * Keeping the logic here (not inlined in the controller) lets story
 * tests verify state transitions without booting Nest or a DB.
 */

import type { EmailOutboxStatus } from "./email-outbox-planner.js";

export type AdminAction = "retry" | "cancel";

export type AdminActionDecision = { allowed: true } | { allowed: false; reason: string };

/**
 * Determines whether an admin action is allowed given the record's
 * current status.
 *
 * Rules:
 *  - `retry`:  allowed from `pending` | `dead-letter`, forbidden from `sent` | `cancelled`
 *  - `cancel`: allowed from `pending` | `dead-letter`, forbidden from `sent` | `cancelled`
 */
export function planOutboxAdminAction(
  action: AdminAction,
  currentStatus: EmailOutboxStatus,
): AdminActionDecision {
  switch (action) {
    case "retry": {
      if (currentStatus === "sent") {
        return { allowed: false, reason: "record is already sent — retry is not meaningful" };
      }
      if (currentStatus === "cancelled") {
        return { allowed: false, reason: "record is cancelled — re-enqueue a new record instead" };
      }
      // pending (including in-flight) and dead-letter are retryable
      return { allowed: true };
    }
    case "cancel": {
      if (currentStatus === "sent") {
        return { allowed: false, reason: "record is already sent — cancel has no effect" };
      }
      if (currentStatus === "cancelled") {
        return { allowed: false, reason: "record is already cancelled" };
      }
      // pending (including in-flight) and dead-letter can be cancelled
      return { allowed: true };
    }
    default: {
      const _exhaustive: never = action;
      return { allowed: false, reason: `unknown action: ${String(_exhaustive)}` };
    }
  }
}

export interface ListFilterInput {
  status?: string;
  recipient?: string;
  template?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  cursor?: string;
  limit?: string;
}

export interface ListFilterParsed {
  status?: EmailOutboxStatus;
  recipient?: string;
  template?: string;
  dateFrom?: Date;
  dateTo?: Date;
  sortBy?: "time" | "attempts";
  cursor?: string;
  limit: number;
}

export type ListFilterValidation =
  | { ok: true; filter: ListFilterParsed }
  | { ok: false; reason: string };

const VALID_STATUSES: readonly string[] = ["pending", "sent", "dead-letter", "cancelled"];

/**
 * Parses and validates raw query-string parameters for the list
 * endpoint. Returns either a validated filter or a rejection reason.
 */
export function parseOutboxListFilter(input: ListFilterInput): ListFilterValidation {
  // status
  let status: EmailOutboxStatus | undefined;
  if (input.status !== undefined && input.status !== "") {
    if (!VALID_STATUSES.includes(input.status)) {
      return {
        ok: false,
        reason: `invalid status "${input.status}"; allowed: ${VALID_STATUSES.join(", ")}`,
      };
    }
    status = input.status as EmailOutboxStatus;
  }

  // recipient (substring filter — no format constraints, just trim)
  const recipient = input.recipient?.trim() || undefined;

  // template
  const template = input.template?.trim() || undefined;

  // dateFrom / dateTo
  let dateFrom: Date | undefined;
  let dateTo: Date | undefined;
  if (input.dateFrom) {
    const d = new Date(input.dateFrom);
    if (Number.isNaN(d.getTime()))
      return { ok: false, reason: `invalid dateFrom "${input.dateFrom}"` };
    dateFrom = d;
  }
  if (input.dateTo) {
    const d = new Date(input.dateTo);
    if (Number.isNaN(d.getTime())) return { ok: false, reason: `invalid dateTo "${input.dateTo}"` };
    dateTo = d;
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return { ok: false, reason: "dateFrom must not be after dateTo" };
  }

  // sortBy
  let sortBy: "time" | "attempts" | undefined;
  if (input.sortBy) {
    if (input.sortBy !== "time" && input.sortBy !== "attempts") {
      return { ok: false, reason: `invalid sortBy "${input.sortBy}"; allowed: time, attempts` };
    }
    sortBy = input.sortBy;
  }

  // limit
  let limit = 50;
  if (input.limit !== undefined) {
    const n = Number.parseInt(input.limit, 10);
    if (!Number.isFinite(n) || n < 1 || n > 200) {
      return { ok: false, reason: "limit must be an integer between 1 and 200" };
    }
    limit = n;
  }

  return {
    ok: true,
    filter: { status, recipient, template, dateFrom, dateTo, sortBy, cursor: input.cursor, limit },
  };
}
