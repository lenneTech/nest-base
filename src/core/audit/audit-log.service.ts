/**
 * Audit-Log builder.
 *
 * Pure entry-shape builder that the Audit-Browser UI reads back.
 * The persistence layer (Prisma `AuditLog` table) calls this with
 * the request context + before/after snapshots and stores the
 * returned entry verbatim.
 *
 * Encryption-awareness: when the caller marks a field as encrypted
 * (project-level `features.fieldEncryption`), the builder rewrites
 * its value with the literal `[encrypted]` marker in BOTH
 * halves. A leaked audit row therefore reveals "this field changed"
 * but never "the new value was X" — the cleartext exists only in
 * the encrypted column on the source table.
 */

export type AuditAction = "create" | "update" | "delete";

export interface AuditLogInput {
  action: AuditAction;
  resource: string;
  resourceId?: string;
  actorUserId?: string;
  tenantId?: string;
  now: () => number;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  /** Names of fields whose values must be masked before persistence. */
  encryptedFields: string[];
}

export interface AuditLogEntry {
  action: AuditAction;
  resource: string;
  resourceId?: string;
  actorUserId?: string;
  tenantId?: string;
  occurredAt: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

const VALID_ACTIONS: AuditAction[] = ["create", "update", "delete"];
const ENCRYPTED_PLACEHOLDER = "[encrypted]";

export class AuditLogActionUnknownError extends Error {
  constructor(action: string) {
    super(`audit-log: unknown action "${action}"`);
    this.name = "AuditLogActionUnknownError";
  }
}

export function buildAuditLogEntry(input: AuditLogInput): AuditLogEntry {
  if (!VALID_ACTIONS.includes(input.action)) {
    throw new AuditLogActionUnknownError(String(input.action));
  }

  const entry: AuditLogEntry = {
    action: input.action,
    resource: input.resource,
    resourceId: input.resourceId,
    actorUserId: input.actorUserId,
    tenantId: input.tenantId,
    occurredAt: new Date(input.now()).toISOString(),
  };

  if (input.before !== undefined) {
    entry.before = maskEncrypted(input.before, input.encryptedFields);
  }
  if (input.after !== undefined) {
    entry.after = maskEncrypted(input.after, input.encryptedFields);
  }

  return entry;
}

function maskEncrypted(
  payload: Record<string, unknown>,
  encryptedFields: string[],
): Record<string, unknown> {
  if (encryptedFields.length === 0) return { ...payload };
  const masked: Record<string, unknown> = { ...payload };
  for (const field of encryptedFields) {
    if (Object.prototype.hasOwnProperty.call(masked, field)) {
      masked[field] = ENCRYPTED_PLACEHOLDER;
    }
  }
  return masked;
}
