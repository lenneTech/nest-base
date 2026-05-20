import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Post,
} from "@nestjs/common";

import { FieldEncryptionService } from "../encryption/field-encryption.service.js";
import { requireTenantContext } from "../multi-tenancy/require-tenant-context.js";
import { Can } from "../permissions/can.guard.js";
import { ADDRESS_STORAGE, type AddressRecord, type AddressStorage } from "./address-storage.js";
import { CreateAddressSchema } from "./geo-dtos.js";
import { decryptAddress, encryptAddress } from "./address-pii-encryption.js";

/**
 * `/addresses` CRUD with field-level encryption for PII columns.
 *
 * Writes pass through `encryptAddress()` before persistence; reads
 * pass through `decryptAddress()` so callers see plaintext. The
 * `street`/`zip` fields stay AES-GCM-ciphertext at rest. When
 * `features.fieldEncryption.enabled=false` the encryption service
 * is unavailable and the controller stores plaintext (the project
 * default for fresh installs without a KEK).
 *
 * Storage is injected via the `ADDRESS_STORAGE` token. Production
 * binds the Prisma-backed adapter (`PrismaAddressStorage`); story
 * tests pass an in-memory adapter (`InMemoryAddressStorage`).
 *
 * Tenant scope comes from session `set-active` (TenantInterceptor ALS).
 * Defense-in-depth alongside RLS on `addresses`.
 */
@Controller("addresses")
export class AddressController {
  constructor(
    @Inject(ADDRESS_STORAGE) private readonly storage: AddressStorage,
    @Optional() private readonly fieldEncryption?: FieldEncryptionService,
  ) {}

  @Can("read", "Address")
  @Get()
  async list(): Promise<AddressRecord[]> {
    const tenantId = requireTenantContext();
    const rows = await this.storage.list(tenantId);
    return rows.map((r) => this.decryptIfEnabled(r));
  }

  @Can("create", "Address")
  @Post()
  async create(@Body() body: unknown): Promise<AddressRecord> {
    const tenantId = requireTenantContext();
    const parsed = CreateAddressSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const bodyTenantId = (body as { tenantId?: unknown })?.tenantId;
    if (typeof bodyTenantId === "string" && bodyTenantId.length > 0 && bodyTenantId !== tenantId) {
      throw new BadRequestException("body.tenantId must match the active tenant context");
    }
    const id = crypto.randomUUID();
    const record: AddressRecord = {
      id,
      tenantId,
      ...parsed.data,
    } as AddressRecord;
    await this.storage.insert(this.encryptIfEnabled(record));
    return record;
  }

  @Can("read", "Address")
  @Get(":id")
  async get(@Param("id") id: string): Promise<AddressRecord> {
    const tenantId = requireTenantContext();
    const r = await this.storage.findById(id, tenantId);
    if (!r) throw new NotFoundException("address not found");
    return this.decryptIfEnabled(r);
  }

  @Can("delete", "Address")
  @Delete(":id")
  async remove(@Param("id") id: string): Promise<{ removed: boolean }> {
    const tenantId = requireTenantContext();
    return { removed: await this.storage.delete(id, tenantId) };
  }

  private encryptIfEnabled(record: AddressRecord): AddressRecord {
    if (!this.fieldEncryption) return record;
    return encryptAddress(this.fieldEncryption, record);
  }

  private decryptIfEnabled(record: AddressRecord): AddressRecord {
    if (!this.fieldEncryption) return record;
    return decryptAddress(this.fieldEncryption, record);
  }
}
