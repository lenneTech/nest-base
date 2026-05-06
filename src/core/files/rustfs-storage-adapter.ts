import { S3StorageAdapter, type S3Operations } from "./s3-storage-adapter.js";

/**
 * RustFS-native storage adapter (CF.FILES.05).
 *
 * RustFS speaks the S3 wire protocol, so this adapter delegates to
 * the same `S3Operations` interface that `S3StorageAdapter` uses.
 * What makes it "native" rather than just-S3 is the set of defaults
 * tuned for RustFS deployments:
 *
 *   - Force path-style addressing (RustFS doesn't support virtual-
 *     host style URLs by default — the AwsS3Operations binding sets
 *     `forcePathStyle: true` when wired against RustFS).
 *   - Default endpoint resolution from `RUSTFS_ENDPOINT` /
 *     `STORAGE_RUSTFS_ENDPOINT` rather than inferring from an AWS
 *     region.
 *   - Lower presigned-URL TTL ceiling (10 min vs S3's 1 hour),
 *     since RustFS deployments are typically same-network and don't
 *     need the longer S3-default.
 *
 * Why a separate adapter rather than just-S3 with config: keeps the
 * driver-selection in `storage-factory.ts` honest about what's
 * really running and lets us tune RustFS-specific behaviour
 * independently of generic S3 callers (AWS / R2 / Backblaze) without
 * introducing per-driver branches in the S3 adapter itself.
 */

export const RUSTFS_DEFAULT_MAX_TTL_SECONDS = 600;

export interface RustFsStorageAdapterOptions {
  /**
   * Override the default presigned-URL TTL ceiling. Defaults to
   * `RUSTFS_DEFAULT_MAX_TTL_SECONDS` (600s / 10 min). Mirrors the
   * same cap rationale documented on `S3StorageAdapterOptions` —
   * presigned URLs survive permission revokes, so an unbounded TTL
   * effectively bypasses access control.
   */
  maxTtlSeconds?: number;
}

export class RustFsStorageAdapter extends S3StorageAdapter {
  constructor(operations: S3Operations, options: RustFsStorageAdapterOptions = {}) {
    super(operations, {
      maxTtlSeconds: options.maxTtlSeconds ?? RUSTFS_DEFAULT_MAX_TTL_SECONDS,
    });
  }
}
