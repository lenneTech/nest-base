import { randomBytes } from "node:crypto";

import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";

import { uuidV7 } from "../../uuid/uuid-v7.js";
import { ApiKeyScopeError, validateApiKeyScopes } from "./api-key-scope-planner.js";

/**
 * Scoped API-Keys.
 *
 * Issuance + verify model:
 *   - Plaintext shipped to client: `nst_pk_<lookupId>_<secret>`
 *   - Stored in DB:  lookupId (UUID v7) + argon2id(secret) + scopes/ttl
 *   - Verify:        split → fetch by lookupId → argon2id verify
 *
 * The lookup-id avoids running argon2 against every row to find a key.
 * The secret stays argon2id-hashed so a DB leak does not yield usable
 * keys.
 */

const PREFIX = "nst_pk_";
const SECRET_BYTES = 32;
// Algorithm.Argon2id = 2 — hardcoded so we can avoid `isolatedModules`-incompatible
// const-enum imports from `@node-rs/argon2`.
const ARGON2_OPTIONS = { algorithm: 2 } as const;
const PLAINTEXT_RE = /^nst_pk_([0-9a-f-]{36})_([0-9a-f]{64})$/;

export class ApiKeyInvalidError extends Error {
  constructor() {
    super("api key is invalid");
    this.name = "ApiKeyInvalidError";
  }
}
export class ApiKeyExpiredError extends Error {
  constructor() {
    super("api key has expired");
    this.name = "ApiKeyExpiredError";
  }
}
export class ApiKeyNotFoundError extends Error {
  constructor(id: string) {
    super(`api key not found: ${id}`);
    this.name = "ApiKeyNotFoundError";
  }
}

export interface ApiKeyRecord {
  id: string;
  lookupId: string;
  hash: string;
  name: string;
  scopes: string[];
  userId: string;
  expiresAt?: Date;
  lastUsedAt?: Date;
}

export interface ApiKeyStorage {
  insert(record: ApiKeyRecord): Promise<ApiKeyRecord>;
  findById(id: string): Promise<ApiKeyRecord | null>;
  findByLookupId(lookupId: string): Promise<ApiKeyRecord | null>;
  listByUser(userId: string): Promise<ApiKeyRecord[]>;
  delete(id: string): Promise<boolean>;
  /**
   * Stamp `last_used_at` on an active key. Returns `false` when no row
   * was updated — meaning the key was deleted or revoked between the
   * `findByLookupId` fetch above and this write (M4 TOCTOU fix).
   */
  updateLastUsed(id: string, at: Date): Promise<boolean>;
  /**
   * Replace the rotation-mutable fields (`lookupId`, `hash`) in place.
   * Returns the updated record or null if `id` is unknown.
   */
  rotate(id: string, lookupId: string, hash: string): Promise<ApiKeyRecord | null>;
}

export interface CreateKeyInput {
  userId: string;
  name: string;
  scopes: string[];
  expiresAt?: Date;
}

export interface CreateKeyResult {
  plaintext: string;
  record: ApiKeyRecord;
}

export interface VerifyResult {
  userId: string;
  scopes: string[];
}

export class ApiKeyService {
  constructor(private readonly storage: ApiKeyStorage) {}

  async createKey(input: CreateKeyInput): Promise<CreateKeyResult> {
    try {
      validateApiKeyScopes(input.scopes);
    } catch (err) {
      if (err instanceof ApiKeyScopeError) throw err;
      throw err;
    }
    const lookupId = uuidV7();
    const secret = randomBytes(SECRET_BYTES).toString("hex");
    const hash = await argon2Hash(secret, ARGON2_OPTIONS);
    const record: ApiKeyRecord = {
      id: uuidV7(),
      lookupId,
      hash,
      name: input.name,
      scopes: input.scopes,
      userId: input.userId,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    };
    const stored = await this.storage.insert(record);
    return { plaintext: `${PREFIX}${lookupId}_${secret}`, record: stored };
  }

  async verifyKey(plaintext: string): Promise<VerifyResult> {
    const match = PLAINTEXT_RE.exec(plaintext);
    if (!match) throw new ApiKeyInvalidError();
    const [, lookupId, secret] = match;
    const record = await this.storage.findByLookupId(lookupId!);
    if (!record) throw new ApiKeyInvalidError();
    if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
      throw new ApiKeyExpiredError();
    }
    const ok = await argon2Verify(record.hash, secret!);
    if (!ok) throw new ApiKeyInvalidError();
    // Close the TOCTOU window: if the key was revoked between `findByLookupId`
    // and this write, `updateLastUsed` returns false (no row updated). Treat
    // that as an invalid key — the caller must not receive a valid VerifyResult
    // for a key that was deleted while the argon2 check was running (M4 fix).
    const stamped = await this.storage.updateLastUsed(record.id, new Date());
    if (!stamped) throw new ApiKeyInvalidError();
    return { userId: record.userId, scopes: record.scopes };
  }

  async rotateKey(id: string): Promise<CreateKeyResult> {
    const existing = await this.findById(id);
    const lookupId = uuidV7();
    const secret = randomBytes(SECRET_BYTES).toString("hex");
    const hash = await argon2Hash(secret, ARGON2_OPTIONS);
    const updated = await this.storage.rotate(existing.id, lookupId, hash);
    if (!updated) throw new ApiKeyNotFoundError(existing.id);
    return { plaintext: `${PREFIX}${lookupId}_${secret}`, record: updated };
  }

  async listByUser(userId: string): Promise<ApiKeyRecord[]> {
    return this.storage.listByUser(userId);
  }

  async revoke(id: string): Promise<void> {
    const removed = await this.storage.delete(id);
    if (!removed) throw new ApiKeyNotFoundError(id);
  }

  private async findById(id: string): Promise<ApiKeyRecord> {
    const match = await this.storage.findById(id);
    if (match) return match;
    throw new ApiKeyNotFoundError(id);
  }
}
