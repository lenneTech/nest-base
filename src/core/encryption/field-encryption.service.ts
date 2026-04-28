import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { KekProvider } from './kek-provider.js';

/**
 * Field-level encryption (PLAN.md §14).
 *
 * AES-256-GCM with a 96-bit random IV per encryption (NIST-recommended)
 * and the 128-bit GCM auth-tag carried alongside. Output format:
 *
 *   `v1:` + base64url( IV(12) || authTag(16) || ciphertext(N) )
 *
 * Tamper detection is automatic — GCM rejects on auth-tag mismatch in
 * `decrypt()`. Version tag (`v1`) reserves room for future formats
 * (different cipher / KEK rotation epoch / AAD inclusion).
 */
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEK_BYTES = 32;
const VERSION = 'v1';

export class FieldEncryptionService {
  constructor(private readonly kek: KekProvider) {}

  encrypt(plaintext: string): string {
    const key = this.assertKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([iv, tag, ct]);
    return `${VERSION}:${base64UrlEncode(payload)}`;
  }

  decrypt(input: string): string {
    const colon = input.indexOf(':');
    if (colon < 0) throw new Error('field-encryption: malformed ciphertext');
    const version = input.slice(0, colon);
    if (version !== VERSION) throw new Error(`field-encryption: unsupported version "${version}"`);

    const payload = base64UrlDecode(input.slice(colon + 1));
    if (payload.length < IV_BYTES + TAG_BYTES) {
      throw new Error('field-encryption: ciphertext too short');
    }
    const iv = payload.subarray(0, IV_BYTES);
    const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ct = payload.subarray(IV_BYTES + TAG_BYTES);

    const key = this.assertKey();
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

  private assertKey(): Buffer {
    const key = this.kek.getKek();
    if (key.length !== KEK_BYTES) {
      throw new Error(`KEK must be exactly ${KEK_BYTES} bytes (received ${key.length})`);
    }
    return key;
  }
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Buffer {
  const restored = value.replaceAll('-', '+').replaceAll('_', '/');
  const pad = restored.length % 4 === 0 ? '' : '='.repeat(4 - (restored.length % 4));
  return Buffer.from(restored + pad, 'base64');
}
