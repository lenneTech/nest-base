import type { Features } from "../features/features.js";

/**
 * Diagnostics report builder.
 *
 * Pure assembler. Inputs are gathered by the surrounding controller
 * (process info, runtime versions, the active Features object) and
 * piped through here to produce the JSON the `/hub/diagnostics`
 * endpoint serves. An admin pastes the response into a bug report
 * when something looks off in prod.
 *
 * Keeping the builder I/O-free buys deterministic tests, and lets
 * us reuse the same shape in fixtures and a future MCP-tool
 * surface (`getDiagnostics` would call straight into here).
 */

export interface DiagnosticsMemorySnapshot {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

export interface DiagnosticsRuntimeEnv {
  nodeVersion: string;
  bunVersion?: string;
  platform: string;
  arch: string;
}

export interface DiagnosticsAppInfo {
  env: "development" | "production" | "test";
  version: string;
  baseUrl: string;
}

export interface DiagnosticsInput {
  now: () => number;
  processStartTime: number;
  memory: () => DiagnosticsMemorySnapshot;
  env: DiagnosticsRuntimeEnv;
  app: DiagnosticsAppInfo;
  features: Features;
  dependencies?: Record<string, string>;
}

export interface DiagnosticsRuntimeReport {
  nodeVersion: string;
  bunVersion?: string;
  platform: string;
  arch: string;
}

export interface DiagnosticsProcessReport {
  uptimeSeconds: number;
  now: string;
  memory: DiagnosticsMemorySnapshot;
}

export interface DiagnosticsFeaturesReport {
  authMethods: string[];
  socialProviders: string[];
  multiTenancy: boolean;
  files: boolean;
  email: boolean;
  webhooks: boolean;
  search: boolean;
  realtime: boolean;
  powerSync: boolean;
  mcp: boolean;
  fieldEncryption: boolean;
  geo: boolean;
  rateLimit: boolean;
  idempotency: boolean;
  observability: boolean;
  jobs: boolean;
}

export interface DiagnosticsReport {
  kind: "diagnostics-report";
  version: 1;
  app: DiagnosticsAppInfo;
  runtime: DiagnosticsRuntimeReport;
  process: DiagnosticsProcessReport;
  features: DiagnosticsFeaturesReport;
  dependencies: Record<string, string>;
}

export function buildDiagnosticsReport(input: DiagnosticsInput): DiagnosticsReport {
  const nowMs = input.now();
  if (nowMs < input.processStartTime) {
    throw new Error(
      `diagnostics: negative uptime (now=${nowMs} < startTime=${input.processStartTime})`,
    );
  }
  const uptimeSeconds = Math.floor((nowMs - input.processStartTime) / 1000);

  const runtime: DiagnosticsRuntimeReport = {
    nodeVersion: input.env.nodeVersion,
    platform: input.env.platform,
    arch: input.env.arch,
    ...(input.env.bunVersion ? { bunVersion: input.env.bunVersion } : {}),
  };

  return {
    kind: "diagnostics-report",
    version: 1,
    app: { ...input.app },
    runtime,
    process: {
      uptimeSeconds,
      now: new Date(nowMs).toISOString(),
      memory: { ...input.memory() },
    },
    features: summariseFeatures(input.features),
    dependencies: input.dependencies ? { ...input.dependencies } : {},
  };
}

function summariseFeatures(features: Features): DiagnosticsFeaturesReport {
  const authToggles: string[] = [];
  if (features.authMethods.emailPassword) authToggles.push("emailPassword");
  if (features.authMethods.twoFactor) authToggles.push("twoFactor");
  if (features.authMethods.passkey) authToggles.push("passkey");
  if (features.authMethods.apiKeys) authToggles.push("apiKeys");
  authToggles.sort();
  return {
    authMethods: authToggles,
    socialProviders: [...features.authMethods.socialProviders].sort(),
    multiTenancy: features.multiTenancy.enabled,
    files: features.files.enabled,
    email: features.email.enabled,
    webhooks: features.webhooks.enabled,
    search: features.search.enabled,
    realtime: features.realtime.enabled,
    powerSync: features.powerSync.enabled,
    mcp: features.mcp.enabled,
    fieldEncryption: features.fieldEncryption.enabled,
    geo: features.geo.enabled,
    rateLimit: features.rateLimit.enabled,
    idempotency: features.idempotency.enabled,
    observability: features.observability.enabled,
    jobs: features.jobs.enabled,
  };
}
