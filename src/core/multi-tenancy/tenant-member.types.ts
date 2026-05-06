/**
 * Shared tenant-member types.
 *
 * These types were previously in `tenant-member.service.ts` (the old
 * hand-rolled TenantMember stack). After issue #118, the canonical
 * tenant layer is Better-Auth's `organization`/`member` tables, but
 * the types are preserved here so the storage adapters and the
 * self-service service can continue to use a stable interface.
 *
 * `TenantMemberStatus` maps as follows to the BA model:
 *   - "ACTIVE"    → presence of a `member` row (BA only stores active members)
 *   - "INVITED"   → existence of an `invitation` row with `status = "pending"`
 *   - "SUSPENDED" → absence of both rows (removed on suspend)
 */

export type TenantMemberStatus = "ACTIVE" | "INVITED" | "SUSPENDED";

export interface TenantMemberRecord {
  id: string;
  userId: string;
  tenantId: string;
  role: string;
  status: TenantMemberStatus;
  invitedAt?: Date;
  joinedAt?: Date;
}

export interface TenantMemberStorage {
  findByUserAndTenant(userId: string, tenantId: string): Promise<TenantMemberRecord | null>;
  listByTenant(tenantId: string): Promise<TenantMemberRecord[]>;
  insert(record: TenantMemberRecord): Promise<TenantMemberRecord>;
  updateStatus(id: string, status: TenantMemberStatus): Promise<TenantMemberRecord | null>;
  remove(id: string): Promise<boolean>;
}
