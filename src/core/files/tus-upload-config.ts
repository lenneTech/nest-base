import { z } from "zod";

/**
 * TUS resumable upload config.
 *
 * The actual `@tus/server` v3 binding lands when the storage adapter
 * is wired. This module owns the config schema + sensible defaults.
 */

const DEFAULT_MOUNT = "/api/files/upload";
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024; // 50 MB
const DEFAULT_CHUNK_TTL_SECONDS = 60 * 60 * 24; // 24 h

export const TusUploadConfigSchema = z.object({
  mountPath: z.string().regex(/^\//, 'mount path must start with "/"'),
  maxUploadBytes: z.number().int().positive(),
  allowedMimeTypes: z.array(z.string()),
  chunkExpirationSeconds: z.number().int().positive(),
});

export type TusUploadConfig = z.infer<typeof TusUploadConfigSchema>;

export function tusUploadConfigDefaults(): TusUploadConfig {
  return {
    mountPath: DEFAULT_MOUNT,
    maxUploadBytes: DEFAULT_MAX_BYTES,
    allowedMimeTypes: [],
    chunkExpirationSeconds: DEFAULT_CHUNK_TTL_SECONDS,
  };
}

export function resolveTusMountPath(custom?: string): string {
  const candidate = custom ?? DEFAULT_MOUNT;
  if (!candidate.startsWith("/")) {
    throw new Error(`mount path must start with "/" (received: ${candidate})`);
  }
  return candidate;
}
