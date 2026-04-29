/**
 * RustFS testcontainer config builder (PLAN.md §32 Phase 8).
 *
 * Pure function — no `testcontainers` import here so the builder
 * is unit-testable without a Docker daemon. The runner side
 * (the bit that actually `new GenericContainer(image)…starts`)
 * lives next to file-storage integration tests where a Docker
 * dependency is already accepted.
 *
 * Defaults match what local dev expects: rustfs/rustfs:latest,
 * port 9000 (S3 standard), `nst_test`-prefixed credentials so a
 * dev's accidental real-AWS leak still looks obviously test-only.
 */

const DEFAULT_IMAGE = "rustfs/rustfs:latest";
const DEFAULT_PORT = 9000;
const DEFAULT_REGION = "us-east-1";
const DEFAULT_ACCESS_KEY = "nsttestAK";
const DEFAULT_SECRET_KEY = "nsttestSecret123456";

export interface RustFsTestContainerInput {
  image?: string;
  exposedPort?: number;
  region?: string;
  accessKey?: string;
  secretKey?: string;
}

export interface RustFsTestContainerConfig {
  image: string;
  exposedPort: number;
  region: string;
  accessKey: string;
  secretKey: string;
  env: Record<string, string>;
}

export function buildRustFsContainerConfig(
  input: RustFsTestContainerInput = {},
): RustFsTestContainerConfig {
  const accessKey = input.accessKey ?? DEFAULT_ACCESS_KEY;
  const secretKey = input.secretKey ?? DEFAULT_SECRET_KEY;
  if (input.accessKey !== undefined && !input.accessKey) {
    throw new Error("rustfs-container: accessKey must be a non-empty string");
  }
  if (input.secretKey !== undefined && !input.secretKey) {
    throw new Error("rustfs-container: secretKey must be a non-empty string");
  }
  return {
    image: input.image ?? DEFAULT_IMAGE,
    exposedPort: input.exposedPort ?? DEFAULT_PORT,
    region: input.region ?? DEFAULT_REGION,
    accessKey,
    secretKey,
    env: {
      RUSTFS_ACCESS_KEY: accessKey,
      RUSTFS_SECRET_KEY: secretKey,
      RUSTFS_REGION: input.region ?? DEFAULT_REGION,
    },
  };
}
