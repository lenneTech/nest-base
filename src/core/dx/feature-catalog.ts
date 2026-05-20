import type { Features, ToggleableFeatureKey } from "../features/features.js";

/**
 * Human-readable catalog for every toggleable feature.
 *
 * Pure data — used by `/hub` (overview tile) and `/hub/features` (full
 * page) to render each feature with description, ENV-toggle, and the
 * dependent module surface. Keep this in sync with `FeaturesSchema`
 * when a new feature is added.
 */

export interface FeatureMeta {
  key: ToggleableFeatureKey;
  label: string;
  description: string;
  envKey: string;
  category: "infrastructure" | "communication" | "data" | "integration" | "observability";
  /** Surfaces that activate when this feature flips on. */
  exposes: string[];
}

export const FEATURE_CATALOG: readonly FeatureMeta[] = [
  {
    key: "multiTenancy",
    label: "Tenancy (Organizations + RLS)",
    description:
      "Single tenant mode: Better-Auth Organizations (members, invites, session.activeOrganizationId via set-active) plus Postgres RLS. Disable for single-tenant apps.",
    envKey: "FEATURE_MULTI_TENANCY_ENABLED",
    category: "infrastructure",
    exposes: [
      "/api/auth/organization/*",
      "session.activeOrganizationId",
      "Session activeOrganizationId",
      "Postgres RLS",
      "GET /me/tenants",
      "POST /tenants",
      "/admin/tenants",
    ],
  },
  {
    key: "files",
    label: "Files & Uploads",
    description: "TUS resumable uploads + S3/local/postgres storage adapters + asset pipeline.",
    envKey: "FEATURE_FILES_ENABLED",
    category: "data",
    exposes: ["/files", "/folders", "/assets/:key", "TUS endpoint", "VariantCacheCleanupCron"],
  },
  {
    key: "email",
    label: "Email",
    description: "Nodemailer + Brevo driver, EJS-subset templates for transactional mail.",
    envKey: "FEATURE_EMAIL_ENABLED",
    category: "communication",
    exposes: ["EmailService", "Verification + reset templates"],
  },
  {
    key: "webhooks",
    label: "Webhooks",
    description: "Outbound HMAC-signed webhooks via the Outbox dispatcher with retry + replay.",
    envKey: "FEATURE_WEBHOOKS_ENABLED",
    category: "integration",
    exposes: ["/admin/webhooks", "WebhookDispatcher", "Outbox-Worker"],
  },
  {
    key: "search",
    label: "Full-Text Search",
    description: "Postgres FTS query parser + cross-resource search across registered tables.",
    envKey: "FEATURE_SEARCH_ENABLED",
    category: "data",
    exposes: ["/search", "/admin/search", "SearchService"],
  },
  {
    key: "realtime",
    label: "Realtime",
    description: "Postgres LISTEN/NOTIFY + Socket.IO gateway with channel-filtering.",
    envKey: "FEATURE_REALTIME_ENABLED",
    category: "communication",
    exposes: ["/admin/realtime", "Socket.IO gateway", "Channel rooms"],
  },
  {
    key: "powerSync",
    label: "PowerSync",
    description: "Offline-first sync engine + JWT plugin + conflict resolution.",
    envKey: "FEATURE_POWERSYNC_ENABLED",
    category: "data",
    exposes: ["/powersync/crud", "JWKS endpoint", "powersync container"],
  },
  {
    key: "mcp",
    label: "Model Context Protocol",
    description: "AI-tool integration via MCP server with @McpTool/@McpResource decorators.",
    envKey: "FEATURE_MCP_ENABLED",
    category: "integration",
    exposes: ["McpModule", "@McpTool", "@McpResource"],
  },
  {
    key: "fieldEncryption",
    label: "Field Encryption",
    description: "AES-256-GCM transparent column encryption with KEK rotation.",
    envKey: "FEATURE_FIELD_ENCRYPTION_ENABLED",
    category: "data",
    exposes: ["EncryptionService", "@Encrypted()", "/addresses (street/zip)"],
  },
  {
    key: "geo",
    label: "Geo / Places",
    description: "Geocoding cache + reverse-geocode + nearby search (PostGIS-ready).",
    envKey: "FEATURE_GEO_ENABLED",
    category: "data",
    exposes: ["/geo/geocode", "/places/nearby", "GeocodingCacheCleanupCron"],
  },
  {
    key: "geoIp",
    label: "GeoIP",
    description: "IP→Country/City lookup via offline .mmdb (dbip-lite default, MaxMind opt-in).",
    envKey: "FEATURE_GEO_IP_ENABLED",
    category: "data",
    exposes: ["GeoIpService.lookup()", "scripts/download-geoip.ts", "geoip-init compose service"],
  },
  {
    key: "rateLimit",
    label: "Rate Limiting",
    description: "Multi-window token-bucket rate limiter backed by Postgres.",
    envKey: "FEATURE_RATE_LIMIT_ENABLED",
    category: "infrastructure",
    exposes: ["ThrottlerGuard", "Postgres throttler store", "X-RateLimit headers"],
  },
  {
    key: "idempotency",
    label: "Idempotency",
    description: "Stripe-style Idempotency-Key with sha256-fingerprint deduplication.",
    envKey: "FEATURE_IDEMPOTENCY_ENABLED",
    category: "infrastructure",
    exposes: ["Idempotency-Key header", "IdempotencyKeyInterceptor", "IdempotencyCleanupCron"],
  },
  {
    key: "observability",
    label: "Observability",
    description: "OpenTelemetry traces + Pino logs + traceparent middleware.",
    envKey: "FEATURE_OBSERVABILITY_ENABLED",
    category: "observability",
    exposes: ["OTel SDK", "OTLP exporter", "trace-id/request-id correlation"],
  },
  {
    key: "jobs",
    label: "Background Jobs",
    description:
      "BullMQ job queue (Redis-backed) + scheduled-job decorator; in-memory fallback when REDIS_URL unset.",
    envKey: "FEATURE_JOBS_ENABLED",
    category: "infrastructure",
    exposes: ["JobQueueService", "@ScheduledJob()", "OutboxWorker tick"],
  },
];

/** Drives the active/inactive state by reading the toggle off Features. */
export function isFeatureActive(features: Features, key: ToggleableFeatureKey): boolean {
  const section = features[key];
  if (!section || typeof section !== "object") return false;
  if ("enabled" in section) return Boolean((section as { enabled: unknown }).enabled);
  return false;
}

export function summarizeFeatures(features: Features): {
  active: number;
  total: number;
  available: number;
} {
  const total = FEATURE_CATALOG.length;
  const active = FEATURE_CATALOG.filter((f) => isFeatureActive(features, f.key)).length;
  return { active, total, available: total - active };
}
