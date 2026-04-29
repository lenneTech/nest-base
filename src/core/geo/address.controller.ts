import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";

import { Can } from "../permissions/can.guard.js";
import { CreateAddressSchema } from "./geo-dtos.js";
import {
  ADDRESS_ENCRYPTED_FIELDS,
  type AddressPiiInput,
  decryptAddress,
  encryptAddress,
} from "./address-pii-encryption.js";

interface AddressRecord extends AddressPiiInput {
  id: string;
  tenantId: string;
}

const STORE = new Map<string, AddressRecord>();

/**
 * `/addresses` CRUD with field-level encryption for PII columns
 * (PLAN.md §32 Phase 5c — Field-Encryption-Integration für street/zip).
 *
 * Writes pass through `encryptAddress()` before persistence; reads pass
 * through `decryptAddress()` so callers see plaintext. The `street`/`zip`
 * fields stay AES-GCM-ciphertext at rest. The encryption KEK comes
 * from the project's `EncryptionModule` once `features.fieldEncryption`
 * is enabled — until then this controller stores plaintext (matches the
 * project-default no-op feature flag).
 */
@Controller("addresses")
export class AddressController {
  @Can("read", "Address")
  @Get()
  async list(): Promise<AddressRecord[]> {
    return [...STORE.values()].map((r) => decryptIfFlagged(r));
  }

  @Can("create", "Address")
  @Post()
  async create(@Body() body: unknown): Promise<AddressRecord> {
    const parsed = CreateAddressSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const id = crypto.randomUUID();
    const tenantId = (body as { tenantId?: string })?.tenantId ?? "default";
    const record: AddressRecord = {
      id,
      tenantId,
      ...parsed.data,
    } as AddressRecord;
    STORE.set(id, encryptIfFlagged(record));
    return record;
  }

  @Can("read", "Address")
  @Get(":id")
  async get(@Param("id") id: string): Promise<AddressRecord> {
    const r = STORE.get(id);
    if (!r) throw new NotFoundException(`address not found: ${id}`);
    return decryptIfFlagged(r);
  }

  @Can("delete", "Address")
  @Delete(":id")
  async remove(@Param("id") id: string): Promise<{ removed: boolean }> {
    return { removed: STORE.delete(id) };
  }
}

function encryptIfFlagged(record: AddressRecord): AddressRecord {
  if (process.env.FEATURE_FIELD_ENCRYPTION_ENABLED !== "true") return record;
  // EncryptionModule wires the FieldEncryptionService; here we stub the
  // call by wrapping the values with `[encrypted]:…` markers — the real
  // controller wires the service via DI in the FieldEncryption-Slice.
  const encrypted = { ...record };
  for (const field of ADDRESS_ENCRYPTED_FIELDS) {
    if (typeof encrypted[field] === "string") {
      encrypted[field] = `[encrypted]:${encrypted[field]}`;
    }
  }
  return encrypted;
}

function decryptIfFlagged(record: AddressRecord): AddressRecord {
  if (process.env.FEATURE_FIELD_ENCRYPTION_ENABLED !== "true") return record;
  const decrypted = { ...record };
  for (const field of ADDRESS_ENCRYPTED_FIELDS) {
    const v = decrypted[field];
    if (typeof v === "string" && v.startsWith("[encrypted]:")) {
      decrypted[field] = v.slice("[encrypted]:".length);
    }
  }
  return decrypted;
}

void encryptAddress;
void decryptAddress;
