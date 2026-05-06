import { uuidV7 } from "../uuid/uuid-v7.js";
import type { TenantMemberRecord, TenantMemberStatus } from "./tenant-member.types.js";

/**
 * Tenant self-service.
 *
 * Closes a friction-log finding: a freshly signed-up user has no way
 * to (a) bootstrap their first tenant or (b) discover existing
 * memberships through the public API. This service is the planner
 * layer behind `POST /tenants` (self-service create) and
 * `GET /me/tenants` (list-for-current-user).
 *
 * Design choices:
 *
 *   - Storage-agnostic: every adapter implements `TenantSelfServiceStorage`
 *     so the service is unit-testable with an in-memory fake. The
 *     Prisma-backed adapter wraps the create+member insert in a single
 *     transaction so we never persist a tenant without an owner.
 *
 *   - First-creator role: hard-coded to `"owner"`. The role string is
 *     project-defined (no enum on the Prisma side) — `"owner"` matches
 *     what the system-setup wizard stamps on the bootstrap admin and is
 *     the safe default for self-service. Projects that want different
 *     semantics can replace this service in their DI graph.
 *
 *   - Owner membership is created `ACTIVE` (not `INVITED`): the user is
 *     creating the tenant for themselves; no acceptance flow needed.
 */

export interface TenantPlanRow {
  id: string;
  name: string;
  createdAt: Date;
}

export interface TenantWithMembership {
  tenantId: string;
  tenantName: string;
  tenantCreatedAt: Date;
  memberId: string;
  role: string;
  status: TenantMemberStatus;
  invitedAt?: Date;
  joinedAt?: Date;
}

export interface TenantSelfServiceStorage {
  /**
   * Returns the existing tenant row matching the (case-sensitive) name,
   * or null. The Prisma schema declares `Tenant.name` as `@unique`; this
   * lookup is the pre-flight check that lets us return a clean
   * `TenantNameTakenError` instead of relying on the database's
   * unique-constraint-violation error code.
   */
  findTenantByName(name: string): Promise<TenantPlanRow | null>;
  /**
   * Atomically creates the tenant + its first member. Implementations
   * MUST run both writes in a single transaction; partial state
   * (tenant exists, membership doesn't) would leave the user locked
   * out of the tenant they just created.
   */
  createTenantWithMember(input: {
    tenant: TenantPlanRow;
    member: TenantMemberRecord;
  }): Promise<{ tenant: TenantPlanRow; member: TenantMemberRecord }>;
  /**
   * Returns the joined tenant + membership rows for the user, in any
   * order — the service sorts by tenant name for stable output.
   */
  listMembershipsForUser(userId: string): Promise<TenantWithMembership[]>;
}

export class TenantNameTakenError extends Error {
  constructor(name: string) {
    super(`tenant name already taken: ${name}`);
    this.name = "TenantNameTakenError";
  }
}

export interface CreateTenantInput {
  name: string;
  ownerId: string;
}

const OWNER_ROLE = "owner";

export class TenantSelfServiceService {
  constructor(private readonly storage: TenantSelfServiceStorage) {}

  async createForUser(
    input: CreateTenantInput,
  ): Promise<{ tenant: TenantPlanRow; member: TenantMemberRecord }> {
    const trimmed = input.name?.trim() ?? "";
    if (trimmed.length === 0) {
      throw new Error("tenant name is required");
    }
    if (!input.ownerId) {
      throw new Error("ownerId is required");
    }

    const existing = await this.storage.findTenantByName(trimmed);
    if (existing) {
      throw new TenantNameTakenError(trimmed);
    }

    const now = new Date();
    const tenant: TenantPlanRow = {
      id: uuidV7(),
      name: trimmed,
      createdAt: now,
    };
    const member: TenantMemberRecord = {
      id: uuidV7(),
      userId: input.ownerId,
      tenantId: tenant.id,
      role: OWNER_ROLE,
      // BA member rows are always active — no invite flow for self-service.
      status: "ACTIVE",
      joinedAt: now,
    };

    return this.storage.createTenantWithMember({ tenant, member });
  }

  async listForUser(userId: string): Promise<TenantWithMembership[]> {
    if (!userId) throw new Error("userId is required");
    const rows = await this.storage.listMembershipsForUser(userId);
    return [...rows].sort((a, b) => a.tenantName.localeCompare(b.tenantName));
  }
}
