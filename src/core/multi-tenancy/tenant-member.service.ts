import { uuidV7 } from '../uuid/uuid-v7.js';

/**
 * Tenant-Member CRUD (PLAN.md §5.3).
 *
 * The membership join-table glues users to tenants with a role and a
 * lifecycle status. Service is storage-agnostic — the Prisma adapter
 * lands in a follow-up slice once Better-Auth's session table joins
 * the schema.
 */

export type TenantMemberStatus = 'ACTIVE' | 'INVITED' | 'SUSPENDED';

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

export class TenantMemberAlreadyExistsError extends Error {
  constructor(userId: string, tenantId: string) {
    super(`tenant member already exists for (userId=${userId}, tenantId=${tenantId})`);
    this.name = 'TenantMemberAlreadyExistsError';
  }
}

export class TenantMemberNotFoundError extends Error {
  constructor(id: string) {
    super(`tenant member not found: ${id}`);
    this.name = 'TenantMemberNotFoundError';
  }
}

export interface AddMemberInput {
  userId: string;
  tenantId: string;
  role: string;
}

export class TenantMemberService {
  constructor(private readonly storage: TenantMemberStorage) {}

  async add(input: AddMemberInput): Promise<TenantMemberRecord> {
    const existing = await this.storage.findByUserAndTenant(input.userId, input.tenantId);
    if (existing) {
      throw new TenantMemberAlreadyExistsError(input.userId, input.tenantId);
    }
    const record: TenantMemberRecord = {
      id: uuidV7(),
      userId: input.userId,
      tenantId: input.tenantId,
      role: input.role,
      status: 'INVITED',
      invitedAt: new Date(),
    };
    return this.storage.insert(record);
  }

  async listByTenant(tenantId: string): Promise<TenantMemberRecord[]> {
    return this.storage.listByTenant(tenantId);
  }

  async activate(id: string): Promise<TenantMemberRecord> {
    const updated = await this.storage.updateStatus(id, 'ACTIVE');
    if (!updated) throw new TenantMemberNotFoundError(id);
    if (!updated.joinedAt) {
      updated.joinedAt = new Date();
    }
    return updated;
  }

  async suspend(id: string): Promise<TenantMemberRecord> {
    const updated = await this.storage.updateStatus(id, 'SUSPENDED');
    if (!updated) throw new TenantMemberNotFoundError(id);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const removed = await this.storage.remove(id);
    if (!removed) throw new TenantMemberNotFoundError(id);
  }
}
