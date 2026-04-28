import { z } from 'zod';

import type { AppEnv } from '../http/cookie-cors-config.js';

/**
 * Feature-Flag-System (PLAN.md §20).
 *
 * Single source of truth for runtime module-activation. Consumed by:
 *   - `AppModule` via `conditionalImport()` — gates module registration
 *   - `validateFeatureDependencies()` — fail-fast on incompatible combos
 *   - Migration / schema-concat scripts — only run feature-owned SQL
 *     for active features
 *
 * Activation precedence:
 *   1. defaults from this schema
 *   2. ENV-Vars `FEATURE_*` (parsed by `loadFeatures()`)
 *   3. (future) project-specific `features.local.ts` overrides
 */

const SOCIAL_PROVIDERS = ['google', 'github', 'apple', 'discord'] as const;
const STORAGE_DRIVERS = ['s3', 'local', 'postgres'] as const;
const EMAIL_PROVIDERS = ['smtp', 'brevo'] as const;
const GEO_PROVIDERS = ['mapbox', 'google', 'nominatim', 'local'] as const;

// Per-section schemas — defined separately so we can pre-parse their
// defaults and feed them into the parent `.default()` call. Zod 4's
// `.default({})` on an object stops at the literal value and skips inner
// defaults, so we hand it the fully-resolved shape instead.
const AuthMethodsSchema = z.object({
  emailPassword: z.boolean().default(true),
  socialProviders: z.array(z.enum(SOCIAL_PROVIDERS)).default([]),
  twoFactor: z.boolean().default(true),
  passkey: z.boolean().default(true),
  apiKeys: z.boolean().default(true),
});
const MultiTenancySchema = z.object({
  enabled: z.boolean().default(true),
  rls: z.boolean().default(true),
  headerName: z.string().default('x-tenant-id'),
});
const FilesSchema = z.object({
  enabled: z.boolean().default(true),
  storageDefault: z.enum(STORAGE_DRIVERS).default('s3'),
  tus: z.boolean().default(true),
  transformations: z.boolean().default(true),
});
const EmailSchema = z.object({
  enabled: z.boolean().default(true),
  provider: z.enum(EMAIL_PROVIDERS).default('smtp'),
});
const GeoSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(GEO_PROVIDERS).default('nominatim'),
});
const togglableDefault = (on: boolean) => z.object({ enabled: z.boolean().default(on) });

const Webhooks = togglableDefault(false);
const Search = togglableDefault(false);
const Realtime = togglableDefault(false);
const PowerSync = togglableDefault(false);
const Mcp = togglableDefault(false);
const FieldEncryption = togglableDefault(false);
const RateLimit = togglableDefault(true);
const Idempotency = togglableDefault(true);
const Observability = togglableDefault(true);
const Jobs = togglableDefault(true);

export const FeaturesSchema = z.object({
  authMethods: AuthMethodsSchema.default(() => AuthMethodsSchema.parse({})),
  multiTenancy: MultiTenancySchema.default(() => MultiTenancySchema.parse({})),
  files: FilesSchema.default(() => FilesSchema.parse({})),
  email: EmailSchema.default(() => EmailSchema.parse({})),
  webhooks: Webhooks.default(() => Webhooks.parse({})),
  search: Search.default(() => Search.parse({})),
  realtime: Realtime.default(() => Realtime.parse({})),
  powerSync: PowerSync.default(() => PowerSync.parse({})),
  mcp: Mcp.default(() => Mcp.parse({})),
  fieldEncryption: FieldEncryption.default(() => FieldEncryption.parse({})),
  geo: GeoSchema.default(() => GeoSchema.parse({})),
  rateLimit: RateLimit.default(() => RateLimit.parse({})),
  idempotency: Idempotency.default(() => Idempotency.parse({})),
  observability: Observability.default(() => Observability.parse({})),
  jobs: Jobs.default(() => Jobs.parse({})),
});

export type Features = z.infer<typeof FeaturesSchema>;
export type FeatureKey = keyof Features;

export type ToggleableFeatureKey =
  | 'multiTenancy'
  | 'files'
  | 'email'
  | 'webhooks'
  | 'search'
  | 'realtime'
  | 'powerSync'
  | 'mcp'
  | 'fieldEncryption'
  | 'geo'
  | 'rateLimit'
  | 'idempotency'
  | 'observability'
  | 'jobs';

/**
 * `loadFeatures(env)` reads `FEATURE_*` ENV-vars and merges them onto the
 * defaults defined by the schema. Boolean values accept `true`/`false`/
 * `1`/`0`/`yes`/`no` (case-insensitive).
 */
export function loadFeatures(env: Record<string, string | undefined>): Features {
  const overrides = parseFeatureEnv(env);
  return FeaturesSchema.parse(overrides);
}

const TRUTHY = new Set(['true', '1', 'yes', 'on']);
const FALSY = new Set(['false', '0', 'no', 'off']);

function parseBool(raw: string): boolean {
  const lower = raw.toLowerCase();
  if (TRUTHY.has(lower)) return true;
  if (FALSY.has(lower)) return false;
  throw new Error(`expected boolean, got "${raw}"`);
}

interface RawOverrides {
  [section: string]: Record<string, unknown>;
}

const SECTION_KEYS = new Set([
  'AUTH_METHODS',
  'MULTI_TENANCY',
  'FILES',
  'EMAIL',
  'WEBHOOKS',
  'SEARCH',
  'REALTIME',
  'POWERSYNC',
  'MCP',
  'FIELDENCRYPTION',
  'FIELD_ENCRYPTION',
  'GEO',
  'RATELIMIT',
  'RATE_LIMIT',
  'IDEMPOTENCY',
  'OBSERVABILITY',
  'JOBS',
]);

const SECTION_TO_KEY: Record<string, FeatureKey> = {
  AUTH_METHODS: 'authMethods',
  MULTI_TENANCY: 'multiTenancy',
  FILES: 'files',
  EMAIL: 'email',
  WEBHOOKS: 'webhooks',
  SEARCH: 'search',
  REALTIME: 'realtime',
  POWERSYNC: 'powerSync',
  MCP: 'mcp',
  FIELDENCRYPTION: 'fieldEncryption',
  FIELD_ENCRYPTION: 'fieldEncryption',
  GEO: 'geo',
  RATELIMIT: 'rateLimit',
  RATE_LIMIT: 'rateLimit',
  IDEMPOTENCY: 'idempotency',
  OBSERVABILITY: 'observability',
  JOBS: 'jobs',
};

const FIELD_TO_PROP: Record<string, string> = {
  ENABLED: 'enabled',
  STORAGE_DEFAULT: 'storageDefault',
  TUS: 'tus',
  TRANSFORMATIONS: 'transformations',
  RLS: 'rls',
  HEADER_NAME: 'headerName',
  PROVIDER: 'provider',
  EMAILPASSWORD: 'emailPassword',
  EMAIL_PASSWORD: 'emailPassword',
  TWOFACTOR: 'twoFactor',
  TWO_FACTOR: 'twoFactor',
  PASSKEY: 'passkey',
  APIKEYS: 'apiKeys',
  API_KEYS: 'apiKeys',
  SOCIALPROVIDERS: 'socialProviders',
  SOCIAL_PROVIDERS: 'socialProviders',
};

const STRING_VALUE_PROPS = new Set(['storageDefault', 'headerName', 'provider']);
const ARRAY_VALUE_PROPS = new Set(['socialProviders']);

function parseFeatureEnv(env: Record<string, string | undefined>): RawOverrides {
  const out: RawOverrides = {};
  for (const [key, raw] of Object.entries(env)) {
    if (raw === undefined || raw === '') continue;
    if (!key.startsWith('FEATURE_')) continue;
    const remainder = key.slice('FEATURE_'.length);
    const { section, field } = splitSectionField(remainder);
    if (!section) continue;

    const sectionKey = SECTION_TO_KEY[section];
    if (!sectionKey) continue;

    const fieldProp = FIELD_TO_PROP[field] ?? field.toLowerCase();
    out[sectionKey] ??= {};
    out[sectionKey]![fieldProp] = coerceValue(fieldProp, raw);
  }
  return out;
}

function splitSectionField(remainder: string): { section: string; field: string } {
  const parts = remainder.split('_');
  for (let take = parts.length - 1; take >= 1; take--) {
    const candidate = parts.slice(0, take).join('_');
    if (SECTION_KEYS.has(candidate)) {
      return { section: candidate, field: parts.slice(take).join('_') };
    }
  }
  return { section: '', field: '' };
}

function coerceValue(prop: string, raw: string): unknown {
  if (STRING_VALUE_PROPS.has(prop)) return raw;
  if (ARRAY_VALUE_PROPS.has(prop)) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return parseBool(raw);
}

export interface ValidationContext {
  env?: AppEnv;
}

/**
 * Fail-fast validator: a feature must not enable without its required
 * base feature being on too. Production tightens additional invariants
 * (rate-limiting must stay on).
 */
export function validateFeatureDependencies(features: Features, ctx: ValidationContext = {}): void {
  if (features.webhooks.enabled && !features.jobs.enabled) {
    throw new Error('feature `webhooks` requires `jobs` (pg-boss queue) to be enabled');
  }
  if (features.powerSync.enabled && !features.multiTenancy.enabled) {
    throw new Error(
      'feature `powerSync` currently requires `multiTenancy` to be enabled (sync-rules use tenant buckets)',
    );
  }
  if (ctx.env === 'production' && !features.rateLimit.enabled) {
    throw new Error('feature `rateLimit` must stay enabled in production');
  }
}

/**
 * AppModule helper: returns `[Module]` if the feature is on, `[]` otherwise.
 */
export function conditionalImport<M>(
  features: Features,
  key: ToggleableFeatureKey,
  mod: M,
): M[] {
  return features[key].enabled ? [mod] : [];
}
