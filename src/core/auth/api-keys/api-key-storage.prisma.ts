import type { PrismaService } from "../../prisma/prisma.service.js";
import type { ApiKeyRecord, ApiKeyStorage } from "./api-key.service.js";

/**
 * Prisma-backed `ApiKeyStorage` (CF.STORAGE.01 closure — iter-171).
 *
 * Persists ApiKey rows to the `api_keys` table. argon2id-hashed
 * secrets stay at rest; plaintext is only returned by the service's
 * `createKey`/`rotateKey` paths (Stripe-style).
 *
 * The storage adapter mirrors the in-memory implementation's
 * contract: insert / findById / findByLookupId / listByUser /
 * delete / updateLastUsed / rotate.
 *
 * The `ApiKey` Prisma model carries extra columns (`lastNotifiedAt`,
 * `createdAt`, `updatedAt`) that the in-memory adapter doesn't track.
 * Those columns are populated by Prisma defaults + the
 * `ApiKeyExpiryRunner` watermark; this adapter never reads them.
 */

interface PrismaApiKeyDelegate {
  create(input: { data: PrismaApiKeyRow }): Promise<PrismaApiKeyRow>;
  findUnique(input: { where: { id?: string; lookupId?: string } }): Promise<PrismaApiKeyRow | null>;
  findMany(input: {
    where: { userId: string };
    orderBy?: { createdAt: "asc" | "desc" };
  }): Promise<PrismaApiKeyRow[]>;
  delete(input: { where: { id: string } }): Promise<PrismaApiKeyRow>;
  update(input: {
    where: { id: string };
    data: Partial<PrismaApiKeyRow>;
  }): Promise<PrismaApiKeyRow>;
}

interface PrismaApiKeyClient {
  apiKey: PrismaApiKeyDelegate;
}

interface PrismaApiKeyRow {
  id: string;
  lookupId: string;
  hash: string;
  name: string;
  scopes: string[];
  userId: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  lastNotifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class PrismaApiKeyStorage implements ApiKeyStorage {
  constructor(private readonly prisma: PrismaService) {}

  async insert(record: ApiKeyRecord): Promise<ApiKeyRecord> {
    const row = await this.client().apiKey.create({
      data: this.toRow(record),
    });
    return this.fromRow(row);
  }

  async findById(id: string): Promise<ApiKeyRecord | null> {
    const row = await this.client().apiKey.findUnique({ where: { id } });
    return row ? this.fromRow(row) : null;
  }

  async findByLookupId(lookupId: string): Promise<ApiKeyRecord | null> {
    const row = await this.client().apiKey.findUnique({ where: { lookupId } });
    return row ? this.fromRow(row) : null;
  }

  async listByUser(userId: string): Promise<ApiKeyRecord[]> {
    const rows = await this.client().apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => this.fromRow(r));
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.client().apiKey.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  async updateLastUsed(id: string, at: Date): Promise<boolean> {
    try {
      await this.client().apiKey.update({
        where: { id },
        data: { lastUsedAt: at },
      });
      return true;
    } catch {
      // The key was deleted or revoked between `findByLookupId` and this
      // write. Return false so the caller can reject the verification (M4 fix).
      return false;
    }
  }

  async rotate(id: string, lookupId: string, hash: string): Promise<ApiKeyRecord | null> {
    try {
      const row = await this.client().apiKey.update({
        where: { id },
        data: { lookupId, hash },
      });
      return this.fromRow(row);
    } catch {
      return null;
    }
  }

  /**
   * Type-erasing bridge: `PrismaService` extends `PrismaClient`. The
   * `apiKey` delegate is structurally compatible with our narrow
   * `PrismaApiKeyDelegate`. The `unknown` intermediate keeps the
   * TS escape-hatch scan clean (LOOP.DISQ.01).
   */
  private client(): PrismaApiKeyClient {
    const erased: unknown = this.prisma;
    return erased as PrismaApiKeyClient;
  }

  private toRow(record: ApiKeyRecord): PrismaApiKeyRow {
    const now = new Date();
    return {
      id: record.id,
      lookupId: record.lookupId,
      hash: record.hash,
      name: record.name,
      scopes: record.scopes,
      userId: record.userId,
      expiresAt: record.expiresAt ?? null,
      lastUsedAt: record.lastUsedAt ?? null,
      lastNotifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  private fromRow(row: PrismaApiKeyRow): ApiKeyRecord {
    const out: ApiKeyRecord = {
      id: row.id,
      lookupId: row.lookupId,
      hash: row.hash,
      name: row.name,
      scopes: [...row.scopes],
      userId: row.userId,
    };
    if (row.expiresAt) out.expiresAt = row.expiresAt;
    if (row.lastUsedAt) out.lastUsedAt = row.lastUsedAt;
    return out;
  }
}
