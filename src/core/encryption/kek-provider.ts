/**
 * KEK (Key-Encryption-Key) provider.
 *
 * The interface is the swap-point between v1 (env-var) and later
 * Vault / KMS / Doppler integrations (PLAN.md §28.3/#13). Domain code
 * never touches the KEK directly — it goes through this provider so a
 * provider swap is invisible to call-sites.
 */
export interface KekProvider {
  getKek(): Buffer;
}

/** DI token for the KekProvider. NestJS providers register against it. */
export const KEK_PROVIDER = Symbol.for("lt:KekProvider");

const KEK_BYTES = 32; // AES-256

/** Reads the base64-encoded KEK from `FIELD_ENCRYPTION_KEK`. */
export class EnvKekProvider implements KekProvider {
  constructor(private readonly env: Record<string, string | undefined>) {}

  getKek(): Buffer {
    const raw = this.env.FIELD_ENCRYPTION_KEK;
    if (!raw) {
      throw new Error("FIELD_ENCRYPTION_KEK env-var is required");
    }
    const buf = Buffer.from(raw, "base64");
    if (buf.length !== KEK_BYTES) {
      throw new Error(
        `FIELD_ENCRYPTION_KEK must decode to ${KEK_BYTES} bytes (received ${buf.length})`,
      );
    }
    return buf;
  }
}
