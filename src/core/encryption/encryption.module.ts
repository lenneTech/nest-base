import { type DynamicModule, Module } from "@nestjs/common";

import { FieldEncryptionService } from "./field-encryption.service.js";
import { EnvKekProvider, KEK_PROVIDER, type KekProvider } from "./kek-provider.js";

export interface EncryptionModuleOptions {
  /** Defaults to `process.env`; tests override. */
  env?: Record<string, string | undefined>;
  /** Custom KekProvider (Vault / KMS / Doppler) — overrides env-based default. */
  provider?: KekProvider;
}

/**
 * EncryptionModule — provides `FieldEncryptionService` to any module
 * that opts into `features.fieldEncryption.enabled`. The KEK comes
 * from `FIELD_ENCRYPTION_KEK` (base64) by default; consumers swap in
 * a Vault/KMS-backed `KekProvider` via `forRoot({ provider })`.
 *
 * The KEK is read lazily — the module loads even if the env-var is
 * missing; only the first `encrypt()`/`decrypt()` call throws. That
 * matches the CLAUDE.md note: half-set crypto config is almost
 * certainly a deployment mistake, surface it loudly when used.
 */
@Module({})
export class EncryptionModule {
  static forRoot(options: EncryptionModuleOptions = {}): DynamicModule {
    const provider: KekProvider =
      options.provider ??
      new EnvKekProvider(options.env ?? (process.env as Record<string, string | undefined>));

    return {
      module: EncryptionModule,
      providers: [{ provide: KEK_PROVIDER, useValue: provider }, FieldEncryptionService],
      exports: [FieldEncryptionService, KEK_PROVIDER],
      global: true,
    };
  }
}
