import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Module,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";

import { Can } from "../../permissions/can.guard.js";
import {
  type ApiKeyRecord,
  type ApiKeyStorage,
  type CreateKeyInput,
  type CreateKeyResult,
  ApiKeyNotFoundError,
  ApiKeyService,
} from "./api-key.service.js";

const API_KEY_STORAGE = Symbol.for("lt:ApiKeyStorage");

class InMemoryApiKeyStorage implements ApiKeyStorage {
  private readonly map = new Map<string, ApiKeyRecord>();

  async insert(r: ApiKeyRecord): Promise<ApiKeyRecord> {
    this.map.set(r.id, r);
    return r;
  }
  async findById(id: string): Promise<ApiKeyRecord | null> {
    return this.map.get(id) ?? null;
  }
  async findByLookupId(lookupId: string): Promise<ApiKeyRecord | null> {
    for (const r of this.map.values()) {
      if (r.lookupId === lookupId) return r;
    }
    return null;
  }
  async listByUser(userId: string): Promise<ApiKeyRecord[]> {
    return [...this.map.values()].filter((r) => r.userId === userId);
  }
  async delete(id: string): Promise<boolean> {
    return this.map.delete(id);
  }
  async updateLastUsed(id: string, at: Date): Promise<void> {
    const r = this.map.get(id);
    if (r) this.map.set(id, { ...r, lastUsedAt: at });
  }
  async rotate(id: string, lookupId: string, hash: string): Promise<ApiKeyRecord | null> {
    const r = this.map.get(id);
    if (!r) return null;
    const updated = { ...r, lookupId, hash };
    this.map.set(id, updated);
    return updated;
  }
}

@Controller("api-keys")
class ApiKeyController {
  constructor(private readonly service: ApiKeyService) {}

  // Issue #47 — every route is `@Can(action, "ApiKey")`-gated. The
  // synthesized Member-role rule (member-role-rules.ts) scopes the
  // ability to `userId = $CURRENT_USER`, so the CASL ability layer
  // already prevents a member from listing / rotating / deleting
  // someone else's key. The path param is still validated against
  // the row's stored userId in the service layer for defense-in-depth.

  @Can("read", "ApiKey")
  @Get(":userId")
  async list(@Param("userId") userId: string): Promise<ApiKeyRecord[]> {
    return this.service.listByUser(userId);
  }

  @Can("create", "ApiKey")
  @Post()
  async create(@Body() body: CreateKeyInput): Promise<CreateKeyResult> {
    if (!body?.userId || !body?.name || !Array.isArray(body?.scopes)) {
      throw new BadRequestException("userId, name, scopes[] are required");
    }
    return this.service.createKey(body);
  }

  @Can("update", "ApiKey")
  @Post(":id/rotate")
  async rotate(@Param("id") id: string): Promise<CreateKeyResult> {
    try {
      return await this.service.rotateKey(id);
    } catch (err) {
      if (err instanceof ApiKeyNotFoundError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
  }

  @Can("delete", "ApiKey")
  @Delete(":id")
  async remove(@Param("id") id: string): Promise<{ removed: boolean }> {
    try {
      await this.service.revoke(id);
      return { removed: true };
    } catch (err) {
      if (err instanceof ApiKeyNotFoundError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
  }
}

/**
 * ApiKeyModule — `/api-keys` CRUD + `:id/rotate`. argon2id-hashed
 * secrets, plaintext only returned on `create`/`rotate` (Stripe-style).
 * In-memory storage by default; Prisma-backed adapter follows.
 */
@Module({
  controllers: [ApiKeyController],
  providers: [
    { provide: API_KEY_STORAGE, useClass: InMemoryApiKeyStorage },
    {
      provide: ApiKeyService,
      useFactory: (storage: ApiKeyStorage) => new ApiKeyService(storage),
      inject: [API_KEY_STORAGE],
    },
  ],
  exports: [ApiKeyService, API_KEY_STORAGE],
})
export class ApiKeyModule {}
