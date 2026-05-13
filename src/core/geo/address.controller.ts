import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Post,
} from "@nestjs/common";

import { FieldEncryptionService } from "../encryption/field-encryption.service.js";
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
 */
// Iter-204 reviewer-G1+G2 closure: every read/write requires
// `x-tenant-id` and threads the tenant scope through to storage.
// Defense-in-depth alongside the new RLS migration on `addresses`.
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function requireTenantHeader(tenantHeader: string | undefined): string {
  const tenantId = tenantHeader?.trim() ?? "";
  if (tenantId.length === 0) {
    throw new BadRequestException("x-tenant-id header is required");
  }
  if (!UUID_PATTERN.test(tenantId)) {
    throw new BadRequestException("x-tenant-id header must be a valid UUID");
  }
  return tenantId;
}

@Controller("addresses")
export class AddressController {
  constructor(
    @Inject(ADDRESS_STORAGE) private readonly storage: AddressStorage,
    @Optional() private readonly fieldEncryption?: FieldEncryptionService,
  ) {}

  @Can("read", "Address")
  @Get()
  async list(@Headers("x-tenant-id") tenantHeader: string | undefined): Promise<AddressRecord[]> {
    const tenantId = requireTenantHeader(tenantHeader);
    const rows = await this.storage.list(tenantId);
    return rows.map((r) => this.decryptIfEnabled(r));
  }

  @Can("create", "Address")
  @Post()
  async create(
    @Headers("x-tenant-id") tenantHeader: string | undefined,
    @Body() body: unknown,
  ): Promise<AddressRecord> {
    const tenantId = requireTenantHeader(tenantHeader);
    const parsed = CreateAddressSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    // If the body carries a tenantId, it MUST match the header — never
    // trust the body to escape the operator's scope.
    const bodyTenantId = (body as { tenantId?: unknown })?.tenantId;
    if (typeof bodyTenantId === "string" && bodyTenantId.length > 0 && bodyTenantId !== tenantId) {
      throw new BadRequestException("body.tenantId must match the x-tenant-id header");
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
  async get(
    @Headers("x-tenant-id") tenantHeader: string | undefined,
    @Param("id") id: string,
  ): Promise<AddressRecord> {
    const tenantId = requireTenantHeader(tenantHeader);
    const r = await this.storage.findById(id, tenantId);
    if (!r) throw new NotFoundException("address not found");
    return this.decryptIfEnabled(r);
  }

  @Can("delete", "Address")
  @Delete(":id")
  async remove(
    @Headers("x-tenant-id") tenantHeader: string | undefined,
    @Param("id") id: string,
  ): Promise<{ removed: boolean }> {
    const tenantId = requireTenantHeader(tenantHeader);
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
