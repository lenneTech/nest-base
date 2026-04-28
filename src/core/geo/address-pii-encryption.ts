import type { FieldEncryptionService } from '../encryption/field-encryption.service.js';

/**
 * Address PII encryption helpers (PLAN.md §15.3 + §32 Phase 5c).
 *
 * The Address model stores street + zip as PII; persistence wraps
 * them through these helpers so the at-rest representation is
 * AES-256-GCM ciphertext. Read-time decryption reverses the wrap.
 *
 * The audit-log builder already replaces these fields with
 * `[encrypted]` (so a leaked audit row never carries the cleartext);
 * this module covers the source-of-truth column itself.
 */

export const ADDRESS_ENCRYPTED_FIELDS = ['street', 'zip'] as const;

export interface AddressPiiInput {
  street: string;
  zip: string;
  // …other fields pass through verbatim.
  [key: string]: unknown;
}

export type AddressPiiOutput = AddressPiiInput;

export function encryptAddress<T extends AddressPiiInput>(
  service: FieldEncryptionService,
  input: T,
): T {
  return {
    ...input,
    street: service.encrypt(input.street),
    zip: service.encrypt(input.zip),
  };
}

export function decryptAddress<T extends AddressPiiInput>(
  service: FieldEncryptionService,
  input: T,
): T {
  return {
    ...input,
    street: service.decrypt(input.street),
    zip: service.decrypt(input.zip),
  };
}
