import { type DynamicModule, Module, type Provider } from "@nestjs/common";

import { BLIND_INDEX, BlindIndex, planBlindIndexFromEnv } from "./blind-index.js";
import { FieldEncryptionService } from "./field-encryption.service.js";
import { EnvKekProvider, KEK_PROVIDER, type KekProvider } from "./kek-provider.js";

export interface EncryptionModuleOptions {
  /** Defaults to `process.env`; tests override. */
  env?: Record<string, string | undefined>;
  /** Custom KekProvider (Vault / KMS / Doppler) — overrides env-based default. */
  provider?: KekProvider;
  /**
   * Override the BlindIndex provider. When omitted, the module reads
   * `BLIND_INDEX_KEY` from env and registers a `BlindIndex` only if a
   * 32+ byte key is supplied — projects that don't need blind-index
   * lookups skip the env-var entirely and the DI token is never
   * registered.
   */
  blindIndex?: BlindIndex;
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
    const env = options.env ?? (process.env as Record<string, string | undefined>);
    const provider: KekProvider = options.provider ?? new EnvKekProvider(env);

    const providers: Provider[] = [
      { provide: KEK_PROVIDER, useValue: provider },
      FieldEncryptionService,
    ];
    const exports_: (string | symbol | typeof FieldEncryptionService)[] = [
      FieldEncryptionService,
      KEK_PROVIDER,
    ];

    // Register BlindIndex only if the project supplied a key. The DI
    // token is omitted otherwise so consumers that try to inject it
    // without configuring a key get a clear "no provider for
    // BlindIndex" error at boot rather than a silent no-op.
    const blindIndex = resolveBlindIndex(options, env);
    if (blindIndex) {
      providers.push({ provide: BLIND_INDEX, useValue: blindIndex });
      exports_.push(BLIND_INDEX);
    }

    return {
      module: EncryptionModule,
      providers,
      exports: exports_,
      global: true,
    };
  }
}

function resolveBlindIndex(
  options: EncryptionModuleOptions,
  env: Record<string, string | undefined>,
): BlindIndex | null {
  if (options.blindIndex) return options.blindIndex;
  const plan = planBlindIndexFromEnv(env.BLIND_INDEX_KEY);
  if (plan.kind === "absent") return null;
  if (plan.kind === "rejected") {
    throw new Error(`EncryptionModule: ${plan.reason}`);
  }
  return new BlindIndex({ key: plan.key });
}
