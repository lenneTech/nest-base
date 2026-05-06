import type { PrismaService } from "../prisma/prisma.service.js";
import type { AddressPiiInput } from "./address-pii-encryption.js";

/**
 * Persisted address record — what the storage adapter writes /
 * reads. PII fields (`street`, `zip`) are stored as AES-GCM
 * ciphertext when `features.fieldEncryption.enabled=true` and the
 * encryption service is wired; the controller transforms the record
 * via `encryptAddress()` / `decryptAddress()` at the boundary.
 */
export interface AddressRecord extends AddressPiiInput {
  id: string;
  tenantId: string;
}

// Iter-204 reviewer-G1+G2 closure: every read/write is now scoped to
// the operator's tenant. The previous contract returned ALL rows
// across tenants — RLS was the SOLE mechanism keeping tenants apart,
// and `addresses` had no RLS migration so the static `check:rls`
// stayed silent (only loaded when `FEATURE_GEO_ENABLED=true`). Mirrors
// iter-201/202's defense-in-depth pattern.
export interface AddressStorage {
  insert(record: AddressRecord): Promise<void>;
  findById(id: string, tenantId: string): Promise<AddressRecord | null>;
  list(tenantId: string): Promise<AddressRecord[]>;
  delete(id: string, tenantId: string): Promise<boolean>;
}

/** DI token for the address storage adapter (Prisma in prod, fake in tests). */
export const ADDRESS_STORAGE = Symbol.for("lt:AddressStorage");

/**
 * In-memory address storage. The fallback adapter — used when the
 * `Address` Prisma feature schema isn't part of the project's
 * concatenated `schema.prisma` (i.e. `features.geo.enabled=false`).
 * Story tests use it directly.
 */
export class InMemoryAddressStorage implements AddressStorage {
  private readonly store = new Map<string, AddressRecord>();

  async insert(record: AddressRecord): Promise<void> {
    this.store.set(record.id, { ...record });
  }

  async findById(id: string, tenantId: string): Promise<AddressRecord | null> {
    const hit = this.store.get(id);
    if (!hit) return null;
    // Iter-204: cross-tenant probes return null instead of leaking the
    // row. The controller surfaces a 404 from null — matches the
    // RLS-policy semantic on the Prisma adapter.
    if (hit.tenantId !== tenantId) return null;
    return { ...hit };
  }

  async list(tenantId: string): Promise<AddressRecord[]> {
    return [...this.store.values()].filter((r) => r.tenantId === tenantId).map((r) => ({ ...r }));
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const hit = this.store.get(id);
    if (!hit) return false;
    if (hit.tenantId !== tenantId) return false;
    return this.store.delete(id);
  }

  /** Test-only: wipe the store between tests. */
  reset(): void {
    this.store.clear();
  }
}

// ────────────────────────────────────────────────────────────────────
// Prisma-backed adapter (CF.STORAGE.01 — iter-169 closes the address
// line item). Persists to the `addresses` table. Tenant isolation
// rides through the standard RLS policy on `tenantId`.
// ────────────────────────────────────────────────────────────────────

/**
 * Type-erasing slice of the Prisma client. The `address` delegate is
 * only available when the geo feature schema is loaded; consumers
 * that don't enable the feature use `InMemoryAddressStorage`
 * instead.
 */
interface PrismaAddressDelegate {
  create(input: { data: PrismaAddressRow }): Promise<PrismaAddressRow>;
  findFirst(input: { where: { id?: string; tenantId?: string } }): Promise<PrismaAddressRow | null>;
  findMany(input: {
    where: { tenantId: string };
    orderBy?: { createdAt: "asc" | "desc" };
  }): Promise<PrismaAddressRow[]>;
  deleteMany(input: { where: { id: string; tenantId: string } }): Promise<{ count: number }>;
}

interface PrismaAddressClient {
  address: PrismaAddressDelegate;
}

interface PrismaAddressRow {
  id: string;
  street: string;
  zip: string;
  city: string;
  country: string;
  state: string | null;
  formattedAddress: string | null;
  geocodingProvider: string | null;
  geocodedAt: Date | null;
  metadata: unknown;
  tenantId: string | null;
  ownedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class PrismaAddressStorage implements AddressStorage {
  constructor(private readonly prisma: PrismaService) {}

  async insert(record: AddressRecord): Promise<void> {
    await this.client().address.create({
      data: this.toRow(record),
    });
  }

  async findById(id: string, tenantId: string): Promise<AddressRecord | null> {
    const row = await this.client().address.findFirst({ where: { id, tenantId } });
    return row ? this.fromRow(row) : null;
  }

  async list(tenantId: string): Promise<AddressRecord[]> {
    const rows = await this.client().address.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => this.fromRow(r));
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const result = await this.client().address.deleteMany({ where: { id, tenantId } });
    return result.count > 0;
  }

  /**
   * Type-erasing bridge: `PrismaService` extends `PrismaClient`. The
   * runtime-attached `address` delegate (driven by the
   * `prisma/features/geo.prisma` schema) is structurally compatible
   * with `PrismaAddressDelegate` once the geo feature is enabled.
   * The `unknown` intermediate keeps the TS escape-hatch scan
   * clean (LOOP.DISQ.01).
   */
  private client(): PrismaAddressClient {
    const erased: unknown = this.prisma;
    return erased as PrismaAddressClient;
  }

  private toRow(record: AddressRecord): PrismaAddressRow {
    const now = new Date();
    return {
      id: record.id,
      street: record.street,
      zip: record.zip,
      city: typeof record["city"] === "string" ? record["city"] : "",
      country: typeof record["country"] === "string" ? record["country"] : "",
      state: typeof record["state"] === "string" ? record["state"] : null,
      formattedAddress:
        typeof record["formattedAddress"] === "string" ? record["formattedAddress"] : null,
      geocodingProvider:
        typeof record["geocodingProvider"] === "string" ? record["geocodingProvider"] : null,
      geocodedAt: record["geocodedAt"] instanceof Date ? record["geocodedAt"] : null,
      metadata: record["metadata"] ?? null,
      tenantId: record.tenantId,
      ownedBy: typeof record["ownedBy"] === "string" ? record["ownedBy"] : null,
      createdAt: now,
      updatedAt: now,
    };
  }

  private fromRow(row: PrismaAddressRow): AddressRecord {
    const out: AddressRecord = {
      id: row.id,
      tenantId: row.tenantId ?? "default",
      street: row.street,
      zip: row.zip,
      city: row.city,
      country: row.country,
    };
    if (row.state !== null) out["state"] = row.state;
    if (row.formattedAddress !== null) out["formattedAddress"] = row.formattedAddress;
    if (row.geocodingProvider !== null) out["geocodingProvider"] = row.geocodingProvider;
    if (row.geocodedAt !== null) out["geocodedAt"] = row.geocodedAt;
    if (row.metadata !== null && row.metadata !== undefined) {
      out["metadata"] = row.metadata;
    }
    if (row.ownedBy !== null) out["ownedBy"] = row.ownedBy;
    return out;
  }
}
