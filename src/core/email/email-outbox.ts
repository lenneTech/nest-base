import { uuidV7 } from "../uuid/uuid-v7.js";
import {
  DEFAULT_EMAIL_OUTBOX_RETRY,
  type EmailOutboxErrorKind,
  type EmailOutboxRetryConfig,
  type EmailOutboxStatus,
  planEmailRetry,
} from "./email-outbox-planner.js";
import type { EmailSendResult, SendOptions, SendTemplateOptions } from "./email.service.js";

/**
 * Email-Outbox subsystem.
 *
 * `EmailService.send / sendTemplate` (when invoked with `mode:
 * "outbox"`) writes a record here and returns immediately with a
 * synthetic message id (`outbox:<uuid>`). A worker (Nest scheduled
 * lifecycle, see `EmailOutboxModule`) polls pending records and
 * forwards them to the actual driver — at-least-once delivery with
 * exponential backoff, idempotency-key dedup, and a hard
 * dead-letter ceiling.
 *
 * Storage and driver are injected so unit tests run DB-free; the
 * Prisma binding lives next to the module for the same reason.
 */

export type EmailOutboxKind = "send" | "sendTemplate";

/** Persisted payload — exactly the args the EmailService method needs. */
export type EmailOutboxPayload = SendOptions | SendTemplateOptions;

export interface EmailOutboxRecord {
  id: string;
  kind: EmailOutboxKind;
  payload: EmailOutboxPayload;
  /** Optional dedup key — see EmailOutboxRecorder.enqueue(). */
  idempotencyKey: string | null;
  status: EmailOutboxStatus;
  attemptCount: number;
  nextAttemptAt: Date | null;
  /** Set by the worker before dispatch; cleared after the attempt. */
  claimedAt: Date | null;
  lastError: string | null;
  succeededAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What a recorder writes — the long-lived fields are storage-managed. */
export interface AppendInput {
  id: string;
  kind: EmailOutboxKind;
  payload: EmailOutboxPayload;
  idempotencyKey: string | null;
  status: "pending";
  attemptCount: 0;
  nextAttemptAt: null;
  claimedAt: null;
  lastError: null;
  succeededAt: null;
  failedAt: null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmailOutboxListFilter {
  status?: string;
  recipient?: string;
  template?: string;
  dateFrom?: Date;
  dateTo?: Date;
  sortBy?: "time" | "attempts";
  cursor?: string;
  limit?: number;
}

export interface EmailOutboxListResult {
  items: EmailOutboxRecord[];
  nextCursor?: string;
  total: number;
}

export interface EmailOutboxStorage {
  append(record: AppendInput): Promise<void>;
  /** Returns the existing record for `key`, or null if free. */
  findByIdempotencyKey(key: string): Promise<EmailOutboxRecord | null>;
  /** Returns a single record by id, or null. */
  findById(id: string): Promise<EmailOutboxRecord | null>;
  /** Returns dispatchable records (pending, due, no fresh claim). */
  listDispatchable(now: Date, limit: number): Promise<EmailOutboxRecord[]>;
  /** Paginated list with optional filters for the admin UI. */
  listFiltered(filter: EmailOutboxListFilter): Promise<EmailOutboxListResult>;
  /** Atomic claim — returns false if a sibling already grabbed the record. */
  claim(id: string, claimedAt: Date): Promise<boolean>;
  markSent(id: string, at: Date): Promise<boolean>;
  markDeadLetter(id: string, at: Date, error: string): Promise<boolean>;
  recordTransientFailure(
    id: string,
    attemptCount: number,
    nextAttemptAt: Date,
    error: string,
  ): Promise<boolean>;
  /** Admin action: reset attempts and nextAttemptAt so the worker picks it up. */
  markRetry(id: string, at: Date): Promise<boolean>;
  /** Admin action: set status to cancelled. */
  markCancelled(id: string, at: Date): Promise<boolean>;
  countPending(): Promise<number>;
  /** Age in ms of the oldest pending record, or 0 if none. */
  oldestPendingAge(now: Date): Promise<number>;
}

/** Driver wrapper — the worker is decoupled from EmailService internals. */
export interface EmailOutboxDriver {
  dispatch(record: EmailOutboxRecord): Promise<EmailSendResult>;
}

export interface EnqueueInput {
  kind: EmailOutboxKind;
  payload: EmailOutboxPayload;
  /** Optional dedup token — duplicate enqueues return the existing record. */
  idempotencyKey?: string;
}

export interface EmailOutboxRecorderOptions {
  storage: EmailOutboxStorage;
  /** Override for tests; defaults to `() => new Date()`. */
  now?: () => Date;
}

export class EmailOutboxRecorder {
  private readonly storage: EmailOutboxStorage;
  private readonly now: () => Date;

  constructor(options: EmailOutboxRecorderOptions) {
    this.storage = options.storage;
    this.now = options.now ?? (() => new Date());
  }

  async enqueue(input: EnqueueInput): Promise<EmailOutboxRecord> {
    if (input.idempotencyKey) {
      const existing = await this.storage.findByIdempotencyKey(input.idempotencyKey);
      if (existing) return existing;
    }
    const now = this.now();
    const record: AppendInput = {
      id: uuidV7(),
      kind: input.kind,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey ?? null,
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: null,
      claimedAt: null,
      lastError: null,
      succeededAt: null,
      failedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.storage.append(record);
    return record satisfies EmailOutboxRecord;
  }
}

export interface EmailOutboxWorkerOptions {
  storage: EmailOutboxStorage;
  driver: EmailOutboxDriver;
  /** Override for tests; defaults to `() => new Date()`. */
  now?: () => Date;
  retry?: EmailOutboxRetryConfig;
  batchSize?: number;
}

export interface EmailOutboxRunResult {
  /** Records that completed successfully on this tick. */
  sent: number;
  /** Records that failed transiently and were rescheduled. */
  retry: number;
  /** Records that hit the cap or returned a permanent error. */
  deadLetter: number;
}

export class EmailOutboxWorker {
  private readonly storage: EmailOutboxStorage;
  private readonly driver: EmailOutboxDriver;
  private readonly now: () => Date;
  private readonly retry: EmailOutboxRetryConfig;
  private readonly batchSize: number;

  constructor(options: EmailOutboxWorkerOptions) {
    this.storage = options.storage;
    this.driver = options.driver;
    this.now = options.now ?? (() => new Date());
    this.retry = options.retry ?? DEFAULT_EMAIL_OUTBOX_RETRY;
    this.batchSize = options.batchSize ?? 25;
  }

  async runOnce(): Promise<EmailOutboxRunResult> {
    const now = this.now();
    // Issue #50: storage failures (driver-adapter pool exhaustion,
    // disconnect race during graceful shutdown) historically threw
    // raw shapes that bubbled up to setInterval's .catch as `{}`.
    // Re-wrap with a real Error so the lifecycle wrapper always logs
    // a useful message — the serializer at the lifecycle level is the
    // outer guard, this inner guard keeps the contract that
    // `runOnce()` rejects with an `instanceof Error`.
    let candidates: EmailOutboxRecord[];
    try {
      candidates = await this.storage.listDispatchable(now, this.batchSize);
    } catch (raw) {
      throw wrapStorageError("listDispatchable", raw);
    }
    const result: EmailOutboxRunResult = { sent: 0, retry: 0, deadLetter: 0 };

    for (const candidate of candidates) {
      const claimedAt = this.now();
      // claim() returns false when another worker beat us to it — in
      // that case we silently skip this candidate and let the sibling
      // process complete the record. A *throw* (lock conflict, pool
      // exhaustion) on a single record must not abort the whole tick;
      // siblings still need a chance to dispatch. Skip + log-via-lastError
      // and move on.
      let claimed: boolean;
      try {
        claimed = await this.storage.claim(candidate.id, claimedAt);
      } catch {
        continue;
      }
      if (!claimed) continue;

      try {
        await this.driver.dispatch(candidate);
        await this.storage.markSent(candidate.id, this.now());
        result.sent++;
      } catch (raw) {
        const error = toError(raw);
        const errorKind = classifyErrorKind(raw);
        const attemptCount = candidate.attemptCount + 1;
        const plan = planEmailRetry({
          attemptCount,
          errorKind,
          now: this.now(),
          config: this.retry,
        });
        if (plan.terminal) {
          await this.storage.markDeadLetter(candidate.id, this.now(), error.message);
          result.deadLetter++;
        } else {
          await this.storage.recordTransientFailure(
            candidate.id,
            attemptCount,
            plan.nextAttemptAt!,
            error.message,
          );
          result.retry++;
        }
      }
    }

    return result;
  }
}

/**
 * Wraps a non-Error storage throw into a proper `Error` carrying both
 * the original message (when extractable) and a hint at which storage
 * call failed. Issue #50: prevents the lifecycle wrapper from logging
 * `{}` for shapes whose useful payload lives on non-enumerable
 * properties or inside a plain `{ code, message }` object.
 */
function wrapStorageError(call: string, raw: unknown): Error {
  if (raw instanceof Error) {
    // Preserve the original Error but prefix the storage call so logs
    // can pinpoint the failing surface without losing the stack.
    const wrapped = new Error(`emailOutboxStorage.${call}: ${raw.message}`);
    wrapped.stack = raw.stack;
    return wrapped;
  }
  // Try to extract `message` / `code` even from non-Error shapes
  // (Prisma's known-request errors stash these as non-enumerable).
  let detail = "";
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const code = typeof obj.code === "string" ? obj.code : undefined;
    const msg = typeof obj.message === "string" ? obj.message : undefined;
    detail = [code, msg].filter(Boolean).join(": ");
  } else if (typeof raw === "string" && raw.length > 0) {
    detail = raw;
  } else {
    detail = String(raw);
  }
  return new Error(`emailOutboxStorage.${call}: ${detail || "unknown failure"}`);
}

function toError(raw: unknown): Error {
  if (raw instanceof Error) return raw;
  return new Error(typeof raw === "string" ? raw : JSON.stringify(raw));
}

/**
 * Map a thrown value to a transient/permanent classification.
 *
 * Rule: drivers MAY tag the error with a `kind` property; otherwise
 * we default to `transient` (better to retry an unknown failure than
 * dead-letter a recoverable one). The SMTP / Brevo drivers from
 * issue #7 attach their own classification — until they do, this
 * default keeps mail flowing.
 */
function classifyErrorKind(raw: unknown): EmailOutboxErrorKind {
  if (raw && typeof raw === "object" && "kind" in raw) {
    const kind = (raw as { kind?: unknown }).kind;
    if (kind === "permanent") return "permanent";
  }
  return "transient";
}
