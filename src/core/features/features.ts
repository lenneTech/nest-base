import { z } from "zod";

import type { AppEnv } from "../http/cookie-cors-config.js";

/**
 * Feature-Flag-System.
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

const SOCIAL_PROVIDERS = ["google", "github", "apple", "discord"] as const;
const STORAGE_DRIVERS = ["s3", "local", "postgres", "rustfs"] as const;
const EMAIL_PROVIDERS = ["smtp", "brevo"] as const;
const GEO_PROVIDERS = ["mapbox", "google", "nominatim", "local"] as const;
const GEO_IP_PROVIDERS = ["dbip-lite", "maxmind"] as const;

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
  headerName: z.string().default("x-tenant-id"),
});
const FilesSchema = z.object({
  enabled: z.boolean().default(true),
  storageDefault: z.enum(STORAGE_DRIVERS).default("local"),
  tus: z.boolean().default(true),
  transformations: z.boolean().default(true),
});
const EmailSchema = z.object({
  enabled: z.boolean().default(true),
  provider: z.enum(EMAIL_PROVIDERS).default("smtp"),
});
const GeoSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(GEO_PROVIDERS).default("nominatim"),
});
const GeoIpSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(GEO_IP_PROVIDERS).default("dbip-lite"),
  /** Optional MaxMind GeoLite2 license key — only required for `provider=maxmind`. */
  licenseKey: z.string().optional(),
  /** Where the unpacked `.mmdb` lives. `download-geoip` writes here. */
  dbPath: z.string().default("./data/geoip/city.mmdb"),
});
const DEVICE_FINGERPRINT_MODES = ["userAgent+ipSubnet", "userAgent"] as const;
const DeviceManagementSchema = z.object({
  /** Master switch — when off, the sign-in hook short-circuits. */
  enabled: z.boolean().default(false),
  /** Hard cap; the oldest session is auto-revoked when the limit is exceeded. */
  maxDevicesPerUser: z.number().int().positive().default(10),
  /** Email the user when a sign-in lands a previously-unseen fingerprint. */
  notifyOnNewDevice: z.boolean().default(true),
  /**
   * Fingerprint composition. `userAgent+ipSubnet` is the privacy /
   * mobility compromise the planner explains; `userAgent`-only is
   * the strict-privacy mode for jurisdictions that don't allow
   * IP-based tracking. See `src/core/devices/fingerprint.ts`.
   */
  sessionFingerprint: z.enum(DEVICE_FINGERPRINT_MODES).default("userAgent+ipSubnet"),
});
const togglableDefault = (on: boolean) => z.object({ enabled: z.boolean().default(on) });

const Webhooks = togglableDefault(false);
const Search = togglableDefault(false);
const Realtime = togglableDefault(false);
const PowerSync = togglableDefault(false);
const Mcp = togglableDefault(false);
const FieldEncryption = togglableDefault(false);
const MagicLink = togglableDefault(false);
const AdminPlugin = togglableDefault(false);
// Organization is on by default (issue #118): the BA organization plugin
// is now the canonical tenant layer. Opt out via FEATURE_ORGANIZATION_ENABLED=false.
const Organization = togglableDefault(true);
const OneTap = togglableDefault(false);
const OpenAPI = togglableDefault(false);
const RateLimit = togglableDefault(true);
const Idempotency = togglableDefault(true);
const Observability = togglableDefault(true);
// Jobs extends the simple togglable shape with adapter sub-flags.
// `pgBoss` and `bullmq` are mutually-exclusive backend choices;
// when both are false the in-memory queue is used.
const JobsSchema = z.object({
  enabled: z.boolean().default(true),
  /** Use pg-boss as the durable job backend (requires DATABASE_URL). */
  pgBoss: z.boolean().default(false),
  /** Use BullMQ as the durable job backend (requires REDIS_URL). */
  bullmq: z.boolean().default(false),
});
// `audit` gates the audit-log subsystem (the AuditLog Prisma model +
// the audit Prisma extension). Default-on because permission /
// authentication / data-mutation surfaces always need audit traces;
// projects with strict storage budgets opt out via FEATURE_AUDIT_ENABLED=false.
const Audit = togglableDefault(true);

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
  magicLink: MagicLink.default(() => MagicLink.parse({})),
  adminPlugin: AdminPlugin.default(() => AdminPlugin.parse({})),
  organization: Organization.default(() => Organization.parse({})),
  oneTap: OneTap.default(() => OneTap.parse({})),
  openAPI: OpenAPI.default(() => OpenAPI.parse({})),
  geo: GeoSchema.default(() => GeoSchema.parse({})),
  geoIp: GeoIpSchema.default(() => GeoIpSchema.parse({})),
  deviceManagement: DeviceManagementSchema.default(() => DeviceManagementSchema.parse({})),
  rateLimit: RateLimit.default(() => RateLimit.parse({})),
  idempotency: Idempotency.default(() => Idempotency.parse({})),
  observability: Observability.default(() => Observability.parse({})),
  jobs: JobsSchema.default(() => JobsSchema.parse({})),
  audit: Audit.default(() => Audit.parse({})),
});

export type Features = z.infer<typeof FeaturesSchema>;
export type FeatureKey = keyof Features;

export type ToggleableFeatureKey =
  | "multiTenancy"
  | "files"
  | "email"
  | "webhooks"
  | "search"
  | "realtime"
  | "powerSync"
  | "mcp"
  | "fieldEncryption"
  | "magicLink"
  | "adminPlugin"
  | "organization"
  | "oneTap"
  | "openAPI"
  | "geo"
  | "geoIp"
  | "deviceManagement"
  | "rateLimit"
  | "idempotency"
  | "observability"
  | "jobs"
  | "audit";

/**
 * `loadFeatures(env)` reads `FEATURE_*` ENV-vars and merges them onto the
 * defaults defined by the schema. Boolean values accept `true`/`false`/
 * `1`/`0`/`yes`/`no` (case-insensitive).
 */
export function loadFeatures(env: Record<string, string | undefined>): Features {
  const overrides = parseFeatureEnv(env);
  return FeaturesSchema.parse(overrides);
}

const TRUTHY = new Set(["true", "1", "yes", "on"]);
const FALSY = new Set(["false", "0", "no", "off"]);

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
  "AUTH_METHODS",
  "MULTI_TENANCY",
  "FILES",
  "EMAIL",
  "WEBHOOKS",
  "SEARCH",
  "REALTIME",
  "POWERSYNC",
  "MCP",
  "FIELDENCRYPTION",
  "FIELD_ENCRYPTION",
  "MAGICLINK",
  "MAGIC_LINK",
  "ADMINPLUGIN",
  "ADMIN_PLUGIN",
  "ORGANIZATION",
  "ONETAP",
  "ONE_TAP",
  "OPENAPI",
  "OPEN_API",
  "GEO",
  "GEO_IP",
  "DEVICEMANAGEMENT",
  "DEVICE_MANAGEMENT",
  "RATELIMIT",
  "RATE_LIMIT",
  "IDEMPOTENCY",
  "OBSERVABILITY",
  "JOBS",
  "AUDIT",
]);

const SECTION_TO_KEY: Record<string, FeatureKey> = {
  AUTH_METHODS: "authMethods",
  MULTI_TENANCY: "multiTenancy",
  FILES: "files",
  EMAIL: "email",
  WEBHOOKS: "webhooks",
  SEARCH: "search",
  REALTIME: "realtime",
  POWERSYNC: "powerSync",
  MCP: "mcp",
  FIELDENCRYPTION: "fieldEncryption",
  FIELD_ENCRYPTION: "fieldEncryption",
  MAGICLINK: "magicLink",
  MAGIC_LINK: "magicLink",
  ADMINPLUGIN: "adminPlugin",
  ADMIN_PLUGIN: "adminPlugin",
  ORGANIZATION: "organization",
  ONETAP: "oneTap",
  ONE_TAP: "oneTap",
  OPENAPI: "openAPI",
  OPEN_API: "openAPI",
  GEO: "geo",
  GEO_IP: "geoIp",
  DEVICEMANAGEMENT: "deviceManagement",
  DEVICE_MANAGEMENT: "deviceManagement",
  RATELIMIT: "rateLimit",
  RATE_LIMIT: "rateLimit",
  IDEMPOTENCY: "idempotency",
  OBSERVABILITY: "observability",
  JOBS: "jobs",
  AUDIT: "audit",
};

// Sub-field aliases for JOBS section.
// FEATURE_JOBS_PG_BOSS → jobs.pgBoss
// FEATURE_JOBS_BULLMQ  → jobs.bullmq

const FIELD_TO_PROP: Record<string, string> = {
  ENABLED: "enabled",
  PG_BOSS: "pgBoss",
  PGBOSS: "pgBoss",
  BULLMQ: "bullmq",
  STORAGE_DEFAULT: "storageDefault",
  TUS: "tus",
  TRANSFORMATIONS: "transformations",
  RLS: "rls",
  HEADER_NAME: "headerName",
  PROVIDER: "provider",
  EMAILPASSWORD: "emailPassword",
  EMAIL_PASSWORD: "emailPassword",
  TWOFACTOR: "twoFactor",
  TWO_FACTOR: "twoFactor",
  PASSKEY: "passkey",
  APIKEYS: "apiKeys",
  API_KEYS: "apiKeys",
  SOCIALPROVIDERS: "socialProviders",
  SOCIAL_PROVIDERS: "socialProviders",
  LICENSEKEY: "licenseKey",
  LICENSE_KEY: "licenseKey",
  DBPATH: "dbPath",
  DB_PATH: "dbPath",
  MAXDEVICESPERUSER: "maxDevicesPerUser",
  MAX_DEVICES_PER_USER: "maxDevicesPerUser",
  NOTIFYONNEWDEVICE: "notifyOnNewDevice",
  NOTIFY_ON_NEW_DEVICE: "notifyOnNewDevice",
  SESSIONFINGERPRINT: "sessionFingerprint",
  SESSION_FINGERPRINT: "sessionFingerprint",
};

const STRING_VALUE_PROPS = new Set([
  "storageDefault",
  "headerName",
  "provider",
  "licenseKey",
  "dbPath",
  "sessionFingerprint",
]);
const NUMBER_VALUE_PROPS = new Set(["maxDevicesPerUser"]);
const ARRAY_VALUE_PROPS = new Set(["socialProviders"]);

function parseFeatureEnv(env: Record<string, string | undefined>): RawOverrides {
  const out: RawOverrides = {};
  for (const [key, raw] of Object.entries(env)) {
    if (raw === undefined || raw === "") continue;
    if (!key.startsWith("FEATURE_")) continue;
    const remainder = key.slice("FEATURE_".length);
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
  const parts = remainder.split("_");
  for (let take = parts.length - 1; take >= 1; take--) {
    const candidate = parts.slice(0, take).join("_");
    if (SECTION_KEYS.has(candidate)) {
      return { section: candidate, field: parts.slice(take).join("_") };
    }
  }
  return { section: "", field: "" };
}

function coerceValue(prop: string, raw: string): unknown {
  if (STRING_VALUE_PROPS.has(prop)) return raw;
  if (NUMBER_VALUE_PROPS.has(prop)) {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      throw new Error(`expected number, got "${raw}"`);
    }
    return n;
  }
  if (ARRAY_VALUE_PROPS.has(prop)) {
    return raw
      .split(",")
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
    throw new Error("feature `webhooks` requires `jobs` to be enabled");
  }
  if (features.powerSync.enabled && !features.multiTenancy.enabled) {
    throw new Error(
      "feature `powerSync` currently requires `multiTenancy` to be enabled (sync-rules use tenant buckets)",
    );
  }
  if (ctx.env === "production" && !features.rateLimit.enabled) {
    throw new Error("feature `rateLimit` must stay enabled in production");
  }
}

/**
 * AppModule helper: returns `[Module]` if the feature is on, `[]` otherwise.
 */
export function conditionalImport<M>(features: Features, key: ToggleableFeatureKey, mod: M): M[] {
  return features[key].enabled ? [mod] : [];
}
