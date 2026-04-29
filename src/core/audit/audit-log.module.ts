import { Inject, Injectable, Module } from '@nestjs/common';

import {
  type AuditAction,
  type AuditLogEntry,
  type AuditLogInput,
  buildAuditLogEntry,
} from './audit-log.service.js';

export const AUDIT_LOG_SINK = Symbol.for('lt:AuditLogSink');

export interface AuditLogSink {
  /** Called with the builder-produced entry whenever a tracked op runs. */
  record(entry: AuditLogEntry): Promise<void>;
}

class InMemoryAuditLogSink implements AuditLogSink {
  readonly entries: AuditLogEntry[] = [];
  async record(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

@Injectable()
export class AuditLogger {
  constructor(@Inject(AUDIT_LOG_SINK) private readonly sink: AuditLogSink) {}

  /** Builds + persists an audit entry. Pass `encryptedFields` per
   *  resource to ensure encrypted columns never leak in the log. */
  async log(input: Omit<AuditLogInput, 'now'> & { now?: () => number }): Promise<AuditLogEntry> {
    const entry = buildAuditLogEntry({ now: () => Date.now(), ...input });
    await this.sink.record(entry);
    return entry;
  }

  /** Convenience wrapper for the three standard actions. */
  async track(
    action: AuditAction,
    resource: string,
    diff: Pick<AuditLogInput, 'before' | 'after' | 'encryptedFields' | 'actorUserId' | 'tenantId' | 'resourceId'>,
  ): Promise<AuditLogEntry> {
    return this.log({ action, resource, ...diff });
  }
}

/**
 * AuditLogModule — provides `AuditLogger` + an injectable
 * `AUDIT_LOG_SINK` (in-memory by default; Prisma-backed adapter
 * follows when the `AuditLog` model migration lands). Domain modules
 * inject `AuditLogger` and call it from their CRUD paths.
 *
 * Encryption-aware: callers pass the field-encryption registry's
 * encrypted-field list per resource; values for those keys get masked
 * before the sink ever sees them (PLAN.md §32 Phase 8).
 */
@Module({
  providers: [
    { provide: AUDIT_LOG_SINK, useClass: InMemoryAuditLogSink },
    AuditLogger,
  ],
  exports: [AuditLogger, AUDIT_LOG_SINK],
})
export class AuditLogModule {}

export { InMemoryAuditLogSink };
