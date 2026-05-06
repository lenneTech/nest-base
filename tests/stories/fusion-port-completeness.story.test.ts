import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Story · Fusion port completeness (SC.FUSION.03).
 *
 * The PRD's `SC.FUSION.03` requires this test to enumerate every
 * alt-sourced subsystem from `docs/fusion-inventory.md` and assert
 * each has a corresponding file or directory under `src/core/`.
 *
 * The intent is to detect *port regressions* — if someone removes
 * a feature directory from `src/core/`, this test fails before the
 * SDK / OpenAPI / e2e suites notice. It complements
 * `SC.FUSION.04` (regression-free fusion via existing test runs)
 * by also catching deletion-without-replacement.
 *
 * The Phase-2 gap inventory in `docs/fusion-inventory.md` lists
 * subsystems that are *intentionally* not yet ported — those are
 * tracked separately and asserted in their dedicated story tests.
 *
 * If a row here moves into a "pending Phase-2 port" status, remove
 * its assertion from this file *and* update
 * `docs/fusion-inventory.md` in the same commit.
 */

const ROOT = resolve(__dirname, "..", "..");

interface PortAssertion {
  readonly id: string;
  readonly description: string;
  readonly path: string;
}

/**
 * Subsystems that have been ported (or that the current repo natively
 * provided). Each entry maps a PRD row ID → expected file or directory
 * path under src/core/. Phase-2 gaps from
 * docs/fusion-inventory.md are intentionally absent here.
 */
const PORTED_SUBSYSTEMS: readonly PortAssertion[] = [
  // Auth & Identity
  { id: "CF.AUTH.01", description: "Better-Auth core", path: "src/core/auth/better-auth.ts" },
  {
    id: "CF.AUTH.02",
    description: "Better-Auth plugin enumerator",
    path: "src/core/auth/better-auth-plugins.ts",
  },
  {
    id: "CF.AUTH.16-19",
    description: "API keys (scoped + hashed + last-used + expiry + audit)",
    path: "src/core/auth/api-keys/api-key.service.ts",
  },
  {
    id: "CF.AUTH.20",
    description: "PowerSync JWT + JWKS",
    path: "src/core/auth/powersync-jwt.ts",
  },
  {
    id: "CF.AUTH.23",
    description: "Test-ability hatch",
    path: "src/core/permissions/test-ability.ts",
  },

  // Multi-tenancy & permissions
  {
    id: "CF.MTPERM.04",
    description: "RLS runtime check",
    path: "src/core/permissions/rls-runtime-check.ts",
  },
  {
    id: "CF.MTPERM.05",
    description: "check:rls script",
    path: "scripts/check-rls.ts",
  },
  {
    id: "CF.MTPERM.06",
    description: "CASL ability + DB-rule resolver",
    path: "src/core/permissions/casl-ability.ts",
  },
  {
    id: "CF.MTPERM.09",
    description: "@Public decorator",
    path: "src/core/permissions/public.decorator.ts",
  },
  {
    id: "CF.MTPERM.10",
    description: "Route audit planner",
    path: "src/core/permissions/route-audit-planner.ts",
  },
  {
    id: "CF.MTPERM.12-15",
    description: "4-stage output pipeline",
    path: "src/core/output-pipeline/output-pipeline.ts",
  },
  {
    id: "CF.MTPERM.15",
    description: "Output-pipeline safety net",
    path: "src/core/output-pipeline/safety-net.ts",
  },
  {
    id: "CF.MTPERM.20",
    description: "Permission tester",
    path: "src/core/permissions/permission-test.service.ts",
  },

  // Data & persistence
  {
    id: "CF.DATA.01",
    description: "Prisma 7 + driver-adapter",
    path: "src/core/prisma/prisma.service.ts",
  },
  { id: "CF.DATA.14", description: "UUID v7 (app-side)", path: "src/core/uuid/uuid-v7.ts" },
  { id: "CF.DATA.15", description: "Soft-delete + repository", path: "src/core/repository" },
  { id: "CF.DATA.16", description: "ETag concurrency", path: "src/core/concurrency" },
  {
    id: "CF.DATA.18",
    description: "Schema concat planner",
    path: "src/core/setup/schema-concat.ts",
  },

  // Files & storage
  { id: "CF.FILES.01", description: "TUS uploads", path: "src/core/files/tus.module.ts" },
  {
    id: "CF.FILES.02",
    description: "S3 storage adapter",
    path: "src/core/files/s3-storage-adapter.ts",
  },
  {
    id: "CF.FILES.03",
    description: "Local FS adapter",
    path: "src/core/files/local-storage-adapter.ts",
  },
  {
    id: "CF.FILES.04",
    description: "Postgres LO adapter",
    path: "src/core/files/postgres-storage-adapter.ts",
  },
  {
    id: "CF.FILES.07",
    description: "IPX image transforms",
    path: "src/core/files/ipx-server.ts",
  },
  {
    id: "CF.FILES.08",
    description: "Asset presets",
    path: "src/core/files/asset-presets.ts",
  },
  {
    id: "CF.FILES.09",
    description: "File metadata Prisma",
    path: "src/core/files/file-storage.prisma.ts",
  },
  {
    id: "CF.FILES.13-15",
    description: "File Manager UI (tree + search + breadcrumb)",
    path: "src/core/files/file-manager-tree.ts",
  },

  // Email
  {
    id: "CF.EMAIL.01",
    description: "EmailService",
    path: "src/core/email/email.service.ts",
  },
  {
    id: "CF.EMAIL.04",
    description: "React Email templates",
    path: "src/core/email/templates",
  },
  {
    id: "CF.EMAIL.05",
    description: "Email outbox",
    path: "src/core/email/email-outbox.ts",
  },
  {
    id: "CF.EMAIL.06",
    description: "Email outbox planner (backoff)",
    path: "src/core/email/email-outbox-planner.ts",
  },
  {
    id: "CF.EMAIL.07",
    description: "Email outbox error / DLQ",
    path: "src/core/email/email-outbox-error.ts",
  },
  {
    id: "CF.EMAIL.08",
    description: "Email outbox health (lag trip)",
    path: "src/core/email/email-outbox-health.ts",
  },
  {
    id: "CF.EMAIL.12",
    description: "Email Builder",
    path: "src/core/email/email-builder.ts",
  },
  {
    id: "CF.EMAIL.16",
    description: "Email Preview",
    path: "src/core/dx/email-preview.ts",
  },
  {
    id: "CF.EMAIL.17",
    description: "Brand bridge",
    path: "src/core/email/brand.ts",
  },

  // Realtime
  {
    id: "CF.RT.01",
    description: "Realtime service + Socket.IO gateway",
    path: "src/core/realtime/realtime.service.ts",
  },
  {
    id: "CF.RT.02-03",
    description: "Channel decorator + permission filter",
    path: "src/core/realtime/channel-permission.ts",
  },
  {
    id: "CF.RT.05-11",
    description: "Realtime Inspector state + filter",
    path: "src/core/realtime/inspector-state.ts",
  },

  // Webhooks
  {
    id: "CF.WH.01",
    description: "HMAC signature",
    path: "src/core/webhooks/hmac-signature.ts",
  },
  {
    id: "CF.WH.02",
    description: "Retry policy",
    path: "src/core/webhooks/retry-policy.ts",
  },
  {
    id: "CF.WH.06",
    description: "Webhook dispatcher",
    path: "src/core/webhooks/webhook-dispatcher.ts",
  },
  {
    id: "CF.WH.08-10",
    description: "Webhook Inspector store",
    path: "src/core/webhooks/inspector-store.ts",
  },

  // Jobs
  {
    id: "CF.JOBS.01",
    description: "pg-boss adapter (job-queue + outbox + worker)",
    path: "src/core/jobs/job-queue.ts",
  },
  {
    id: "CF.JOBS.03",
    description: "Jobs aggregations",
    path: "src/core/jobs/dev-jobs-aggregations.ts",
  },

  // Observability
  {
    id: "CF.OBS.05-06",
    description: "Ring-buffer log capture",
    path: "src/core/dx/log-buffer.ts",
  },
  {
    id: "CF.OBS.07-08",
    description: "Custom span buffer",
    path: "src/core/dx/trace-buffer.ts",
  },
  {
    id: "CF.OBS.09-10",
    description: "Prisma query buffer",
    path: "src/core/dx/query-buffer.ts",
  },
  {
    id: "CF.OBS.13",
    description: "Diagnostics page",
    path: "src/core/dx/diagnostics.ts",
  },

  // Security
  { id: "CF.SEC.01-03", description: "Field encryption", path: "src/core/encryption" },
  { id: "CF.SEC.06-07", description: "Throttler", path: "src/core/throttler" },
  { id: "CF.SEC.08", description: "Idempotency", path: "src/core/idempotency" },

  // Search
  { id: "CF.SEARCH.01-06", description: "Search + FTS", path: "src/core/search" },

  // Geo
  {
    id: "CF.GEO.01-04",
    description: "Geocoding providers",
    path: "src/core/geo/geocoding-providers.ts",
  },
  {
    id: "CF.GEO.06",
    description: "Address PII encryption",
    path: "src/core/geo/address-pii-encryption.ts",
  },
  {
    id: "CF.GEO.07",
    description: "GeoJSON output mapper",
    path: "src/core/geo/geojson-output-mapper.ts",
  },
  { id: "CF.GEO.08-10", description: "GeoIP", path: "src/core/geoip/geoip.service.ts" },

  // Integration
  { id: "CF.INT.01", description: "MCP server", path: "src/core/mcp/mcp-server.ts" },
  { id: "CF.INT.02", description: "MCP decorators", path: "src/core/mcp/mcp-decorators.ts" },
  { id: "CF.INT.03", description: "MCP auth", path: "src/core/mcp/mcp-auth.ts" },
  {
    id: "CF.INT.05-08",
    description: "PowerSync controllers",
    path: "src/core/auth/powersync.module.ts",
  },

  // GDPR
  { id: "CF.GDPR.01-03", description: "GDPR module", path: "src/core/gdpr" },

  // Audit
  {
    id: "CF.AUDIT.01-06",
    description: "Audit log service",
    path: "src/core/audit/audit-log.service.ts",
  },
  {
    id: "CF.AUDIT.07-12",
    description: "Audit browser types",
    path: "src/core/dx/audit-browser-types.ts",
  },

  // Errors & API stability
  { id: "CF.ERR.01-02", description: "Errors module", path: "src/core/errors" },
  {
    id: "CF.ERR.04-05",
    description: "ResourceNotFoundError sentinel",
    path: "src/core/errors/resource-not-found-error.ts",
  },

  // OpenAPI & SDK
  { id: "CF.OAS.01-07", description: "OpenAPI module", path: "src/core/openapi" },
  { id: "CF.OAS.08", description: "kubb config", path: "kubb.config.ts" },
  {
    id: "CF.OAS.09",
    description: "Offline OpenAPI snapshot",
    path: "docs/openapi.snapshot.json",
  },
  { id: "CF.OAS.10", description: "Snapshot dump script", path: "scripts/dump-openapi.ts" },
  { id: "CF.OAS.11", description: "SDK check script", path: "scripts/sdk-check.ts" },

  // Dev Hub
  { id: "CF.DH.01", description: "Dev Hub SPA shell", path: "src/core/dx/clients" },
  { id: "CF.DH.01", description: "Dev Hub controller", path: "src/core/dx/dev-hub.controller.ts" },
  {
    id: "CF.DH.34-43",
    description: "Admin SPA controller",
    path: "src/core/dx/admin-spa.controller.ts",
  },
  {
    id: "CF.DH.44-48",
    description: "Dev session runner",
    path: "src/core/dx/dev-session-runner.ts",
  },

  // Setup & lifecycle scripts
  { id: "CF.SCRIPTS.01-02", description: "setup-wizard", path: "scripts/setup-wizard.ts" },
  { id: "CF.SCRIPTS.03", description: "onboard", path: "scripts/onboard.ts" },
  { id: "CF.SCRIPTS.04-05", description: "doctor", path: "scripts/doctor.ts" },
  { id: "CF.SCRIPTS.06-08", description: "reset (with prod-safety)", path: "scripts/reset.ts" },
  { id: "CF.SCRIPTS.09", description: "seed", path: "scripts/seed.ts" },
  { id: "CF.SCRIPTS.10", description: "rename", path: "scripts/rename-project.ts" },
  { id: "CF.SCRIPTS.11", description: "add:module", path: "scripts/add-module.ts" },
  {
    id: "CF.SCRIPTS.12",
    description: "sync:from-template",
    path: "scripts/sync-from-template.ts",
  },
  {
    id: "CF.SCRIPTS.13",
    description: "sync:to-template",
    path: "scripts/sync-to-template.ts",
  },
  { id: "CF.SCRIPTS.18", description: "llm-test", path: "scripts/llm-feature-test.ts" },
  {
    id: "CF.SCRIPTS.17",
    description: "docs:screenshots",
    path: "scripts/take-showcase-screenshots.ts",
  },
  {
    id: "CF.SCRIPTS.19",
    description: "check:rls",
    path: "scripts/check-rls.ts",
  },

  // AI tooling
  { id: "CF.AI.13-14", description: "Ralph loop prompt", path: "nest-base-loop-prompt.md" },
  { id: "CF.AI.15", description: "Root CLAUDE.md", path: "CLAUDE.md" },
  { id: "CF.AI.16", description: "src/core CLAUDE.md", path: "src/core/CLAUDE.md" },
  { id: "CF.AI.16", description: "tests CLAUDE.md", path: "tests/CLAUDE.md" },
  { id: "CF.AI.16", description: "prisma CLAUDE.md", path: "prisma/CLAUDE.md" },
];

describe("Story · Fusion port completeness (SC.FUSION.03)", () => {
  for (const subsystem of PORTED_SUBSYSTEMS) {
    it(`${subsystem.id} — ${subsystem.description} → ${subsystem.path}`, () => {
      const fullPath = resolve(ROOT, subsystem.path);
      expect(
        existsSync(fullPath),
        `expected ${subsystem.path} to exist (mapped from ${subsystem.id} in docs/fusion-inventory.md)`,
      ).toBe(true);
    });
  }

  it("docs/fusion-inventory.md exists as the provenance source of truth", () => {
    expect(existsSync(resolve(ROOT, "docs/fusion-inventory.md"))).toBe(true);
  });

  it("docs/fusion-inventory.md enumerates a Phase-2 implementation gap section", async () => {
    const { readFileSync } = await import("node:fs");
    const content = readFileSync(resolve(ROOT, "docs/fusion-inventory.md"), "utf8");
    expect(content).toMatch(/Phase-2 implementation gaps/i);
  });
});
