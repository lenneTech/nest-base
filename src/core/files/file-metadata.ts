import { z } from 'zod';

/**
 * File metadata schema (PLAN.md §8).
 *
 * The shape every storage adapter (S3, Local, Postgres) maps to and
 * the controller emits over the API. Mirrors Directus' file model
 * trimmed to what the template needs.
 */

const STORAGE_DRIVERS = ['s3', 'local', 'postgres'] as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export const FileMetadataSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  uploaderId: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(SHA256_HEX),
  storageDriver: z.enum(STORAGE_DRIVERS),
  storageKey: z.string().min(1),
  uploadedAt: z.date(),
});

export type FileMetadata = z.infer<typeof FileMetadataSchema>;

/**
 * Format a byte count for display. Returns "0 B", "1023 B", "1.0 KB",
 * "1.4 MB", "2.0 GB", "3.5 TB". Uses 1024 as the base (binary IEC).
 */
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
const BASE = 1024;

export function formatFileSize(bytes: number): string {
  if (bytes < 0) throw new Error(`formatFileSize: negative input (${bytes})`);
  if (bytes < BASE) return `${bytes} B`;

  let value = bytes;
  let unitIndex = 0;
  while (value >= BASE && unitIndex < UNITS.length - 1) {
    value /= BASE;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${UNITS[unitIndex]}`;
}
