import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = resolve(import.meta.dirname, "..", "..");

interface SyncRules {
  bucket_definitions: Record<
    string,
    {
      parameters?: string | string[];
      data?: string[];
    }
  >;
}

/**
 * Story · PowerSync sync-rules.yaml (PLAN.md §15.5 + §32 Phase 5b).
 *
 * sync-rules.yaml is what makes the WAL stream user-aware: each bucket
 * names a parameter query (resolves to the user's id / tenant) and a
 * data query (rows visible inside the bucket).  The two security
 * properties we lock here:
 *
 *   1. Buckets ⊆ READ-Permissions — a user only ever subscribes to
 *      `id = token.sub` or `tenantId = token.tenant`.
 *   2. The publication is permissive (FOR ALL TABLES) but sync-rules
 *      is the one place that decides what reaches the device.
 *
 * Tenant-bucket isolation is asserted by the by-token parameter query.
 */
describe("Story · PowerSync sync-rules.yaml", () => {
  function readRules(): { raw: string; parsed: SyncRules } {
    const path = resolve(ROOT, "docker/powersync/sync-rules.yaml");
    expect(existsSync(path), "sync-rules.yaml must exist at docker/powersync/").toBe(true);
    const raw = readFileSync(path, "utf8");
    const parsed = parse(raw) as SyncRules;
    return { raw, parsed };
  }

  it("declares a bucket_definitions section", () => {
    const { parsed } = readRules();
    expect(parsed.bucket_definitions).toBeDefined();
    expect(typeof parsed.bucket_definitions).toBe("object");
  });

  it('defines a "user" bucket scoped to the JWT subject', () => {
    const { parsed } = readRules();
    const bucket = parsed.bucket_definitions.user ?? parsed.bucket_definitions.by_user;
    expect(bucket, "a user-scoped bucket must exist").toBeDefined();
    const params = Array.isArray(bucket!.parameters)
      ? bucket!.parameters.join(" ")
      : (bucket!.parameters ?? "");
    expect(params).toMatch(/token_parameters\.user_id|request\.user_id|token\.sub/);
  });

  it('defines a "tenant" bucket scoped to the JWT tenant claim', () => {
    const { parsed } = readRules();
    const bucket = parsed.bucket_definitions.tenant ?? parsed.bucket_definitions.by_tenant;
    expect(bucket, "a tenant-scoped bucket must exist").toBeDefined();
    const params = Array.isArray(bucket!.parameters)
      ? bucket!.parameters.join(" ")
      : (bucket!.parameters ?? "");
    expect(params).toMatch(/tenant_id|tenantId/i);
  });

  it("user-bucket data queries filter rows by the parameter (no SELECT *)", () => {
    const { parsed } = readRules();
    const bucket = parsed.bucket_definitions.user ?? parsed.bucket_definitions.by_user;
    expect(bucket?.data?.length).toBeGreaterThan(0);
    for (const query of bucket!.data!) {
      // Either WHERE userId / WHERE id is the bucket parameter — never an
      // unfiltered table read.
      expect(query).toMatch(/WHERE/i);
      expect(query).toMatch(/bucket\.|=\s*bucket\./i);
    }
  });

  it("tenant-bucket data queries filter rows by tenantId (RLS-equivalent at sync layer)", () => {
    const { parsed } = readRules();
    const bucket = parsed.bucket_definitions.tenant ?? parsed.bucket_definitions.by_tenant;
    expect(bucket?.data?.length).toBeGreaterThan(0);
    for (const query of bucket!.data!) {
      expect(query).toMatch(/WHERE[\s\S]*tenant/i);
    }
  });

  it("does not expose the audit log or raw secret tables to clients", () => {
    const { raw } = readRules();
    expect(raw).not.toMatch(/FROM\s+audit_log/i);
    expect(raw).not.toMatch(/FROM\s+jwks_keys/i);
    expect(raw).not.toMatch(/FROM\s+sessions?\b/i);
  });
});
