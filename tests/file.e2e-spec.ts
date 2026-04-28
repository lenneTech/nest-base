import { describe, expect, it } from 'vitest';

import {
  FileMetadataSchema,
  formatFileSize,
  type FileMetadata,
} from '../src/core/files/file-metadata.js';

/**
 * Adapted from nest-server `file.e2e-spec.ts`.
 *
 * The full upload + transformation flow lands when the storage
 * adapter and the controller wire up. This spec pins the metadata
 * shape that flows through the pipeline.
 */
describe('File · metadata schema', () => {
  it('accepts a complete file record', () => {
    const record: FileMetadata = {
      id: '019dd4ce-5025-7a98-8fe6-ee8f4a31c2d1',
      tenantId: '019dd4ce-5025-7a98-8fe6-ee8f4a31c2d2',
      uploaderId: '019dd4ce-5025-7a98-8fe6-ee8f4a31c2d3',
      filename: 'avatar.png',
      mimeType: 'image/png',
      sizeBytes: 12_345,
      sha256: '0'.repeat(64),
      storageDriver: 's3',
      storageKey: 'tenant/abc/avatar.png',
      uploadedAt: new Date(),
    };
    expect(FileMetadataSchema.safeParse(record).success).toBe(true);
  });

  it('rejects a record with negative size', () => {
    const result = FileMetadataSchema.safeParse({
      id: '019dd4ce-5025-7a98-8fe6-ee8f4a31c2d1',
      tenantId: '019dd4ce-5025-7a98-8fe6-ee8f4a31c2d2',
      uploaderId: '019dd4ce-5025-7a98-8fe6-ee8f4a31c2d3',
      filename: 'a.txt',
      mimeType: 'text/plain',
      sizeBytes: -1,
      sha256: '0'.repeat(64),
      storageDriver: 's3',
      storageKey: 'k',
      uploadedAt: new Date(),
    });
    expect(result.success).toBe(false);
  });

  it('rejects a record with a malformed sha256 (must be 64 lowercase hex)', () => {
    const result = FileMetadataSchema.safeParse({
      id: '019dd4ce-5025-7a98-8fe6-ee8f4a31c2d1',
      tenantId: '019dd4ce-5025-7a98-8fe6-ee8f4a31c2d2',
      uploaderId: '019dd4ce-5025-7a98-8fe6-ee8f4a31c2d3',
      filename: 'a.txt',
      mimeType: 'text/plain',
      sizeBytes: 1,
      sha256: 'not-a-sha',
      storageDriver: 's3',
      storageKey: 'k',
      uploadedAt: new Date(),
    });
    expect(result.success).toBe(false);
  });

  describe('formatFileSize()', () => {
    it('formats bytes / KB / MB / GB / TB', () => {
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(1023)).toBe('1023 B');
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(1_500_000)).toBe('1.4 MB');
      expect(formatFileSize(2 * 1024 ** 3)).toBe('2.0 GB');
      expect(formatFileSize(3.5 * 1024 ** 4)).toBe('3.5 TB');
    });

    it('rejects negative input', () => {
      expect(() => formatFileSize(-1)).toThrow();
    });
  });
});
