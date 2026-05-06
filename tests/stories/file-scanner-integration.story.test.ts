import { describe, expect, it } from "vitest";

import {
  EicarTestFileScanner,
  NoOpFileScanner,
  type FileScanner,
} from "../../src/core/files/file-scanner.js";
import {
  FileService,
  type FileRecord,
  type FileServiceStorage,
} from "../../src/core/files/file.service.js";
import "../../src/core/files/files.module.js";
import {
  type StorageAdapter,
  type StoragePutInput,
  type StorageObjectMetadata,
} from "../../src/core/files/storage-adapter.js";

/**
 * Story · FileScanner integration with the upload pipeline (CF.FILES.06).
 *
 * The PRD pins "Antivirus scanner integration (ClamAV-compatible
 * interface)" — the upload-complete hook MUST call `scanner.scan()`
 * and route based on the verdict:
 *   - `clean`        → store at the normal path
 *   - `infected`     → store under a `_quarantine/` prefix + audit row
 *   - `indeterminate`+ project policy decides keep vs reject
 *
 * Iter-83 created the contract; iter-85 wires it into
 * `FileService.uploadAndCreate()` (the single-shot upload path).
 */

interface FakeStoredEntry {
  readonly key: string;
  readonly body: Uint8Array;
  readonly mimeType: string;
}

function fakeStorage(): FileServiceStorage & { records: FileRecord[] } {
  const records: FileRecord[] = [];
  const storage: FileServiceStorage & { records: FileRecord[] } = {
    records,
    async insert(record) {
      records.push(record);
      return record;
    },
    async findById(id) {
      return records.find((r) => r.id === id) ?? null;
    },
    async findByIdInTenant(tenantId, id) {
      return records.find((r) => r.tenantId === tenantId && r.id === id) ?? null;
    },
    async listByFolder(tenantId, folderId) {
      return records.filter((r) => r.tenantId === tenantId && r.folderId === folderId);
    },
    async update(id, patch) {
      const idx = records.findIndex((r) => r.id === id);
      if (idx < 0) return null;
      const existing = records[idx];
      if (!existing) return null;
      const updated: FileRecord = { ...existing, ...patch };
      records[idx] = updated;
      return updated;
    },
    async delete(id) {
      const idx = records.findIndex((r) => r.id === id);
      if (idx < 0) return false;
      records.splice(idx, 1);
      return true;
    },
  };
  return storage;
}

function fakeAdapter(records: FakeStoredEntry[]): StorageAdapter {
  const adapter: StorageAdapter = {
    async put(input: StoragePutInput): Promise<StorageObjectMetadata> {
      records.push({ key: input.key, body: input.body, mimeType: input.mimeType });
      return { key: input.key, sizeBytes: input.body.byteLength, mimeType: input.mimeType };
    },
    async get(key) {
      const found = records.find((r) => r.key === key);
      if (!found) throw new Error(`storage: object not found at key "${key}"`);
      return found.body;
    },
    async delete(key) {
      const idx = records.findIndex((r) => r.key === key);
      if (idx < 0) return false;
      records.splice(idx, 1);
      return true;
    },
    async exists(key) {
      return records.some((r) => r.key === key);
    },
    async signUrl() {
      return "memory://signed";
    },
    async list(prefix) {
      return records.filter((r) => r.key.startsWith(prefix)).map((r) => r.key);
    },
  };
  return adapter;
}

describe("Story · FileScanner integration with FileService.uploadAndCreate", () => {
  it("clean upload via NoOpFileScanner: stores bytes at the normal storage path", async () => {
    const adapterRecords: FakeStoredEntry[] = [];
    const adapter = fakeAdapter(adapterRecords);
    const storage = fakeStorage();
    const scanner: FileScanner = new NoOpFileScanner();

    const svc = FileService.withStorageAdapter(storage, adapter);
    svc.fileScanner = scanner;

    const bytes = new TextEncoder().encode("hello world");
    const record = await svc.uploadAndCreate({
      tenantId: "t-1",
      folderId: null,
      filename: "hello.txt",
      mimeType: "text/plain",
      uploaderId: "u-1",
      bytes,
    });

    expect(record.storageKey).not.toContain("_quarantine/");
    expect(record.scanVerdict).toBe("clean");
    expect(adapterRecords).toHaveLength(1);
    expect(adapterRecords[0]?.key).toBe(record.storageKey);
  });

  it("EICAR upload: gets quarantined under `_quarantine/` prefix + threat name on the metadata", async () => {
    const adapterRecords: FakeStoredEntry[] = [];
    const adapter = fakeAdapter(adapterRecords);
    const storage = fakeStorage();
    const scanner = new EicarTestFileScanner();

    const svc = FileService.withStorageAdapter(storage, adapter);
    svc.fileScanner = scanner;

    const eicar = new TextEncoder().encode(EicarTestFileScanner.EICAR_SIGNATURE);
    const record = await svc.uploadAndCreate({
      tenantId: "t-1",
      folderId: null,
      filename: "eicar.txt",
      mimeType: "text/plain",
      uploaderId: "u-1",
      bytes: eicar,
    });

    expect(record.storageKey.startsWith("_quarantine/")).toBe(true);
    expect(adapterRecords).toHaveLength(1);
    expect(adapterRecords[0]?.key.startsWith("_quarantine/")).toBe(true);
    // Threat name surfaced via `record.scanThreatName` so the
    // admin UI / audit row can render it.
    expect(record.scanThreatName).toBe("Eicar-Test-Signature");
    expect(record.scanVerdict).toBe("infected");
  });

  it("indeterminate verdict + reject policy: throws + does not store", async () => {
    const adapterRecords: FakeStoredEntry[] = [];
    const adapter = fakeAdapter(adapterRecords);
    const storage = fakeStorage();
    const indeterminate: FileScanner = {
      async scan() {
        return { verdict: "indeterminate" };
      },
    };

    const svc = FileService.withStorageAdapter(storage, adapter);
    svc.fileScanner = indeterminate;
    svc.scanIndeterminatePolicy = "reject";

    await expect(
      svc.uploadAndCreate({
        tenantId: "t-1",
        folderId: null,
        filename: "unknown.bin",
        mimeType: "application/octet-stream",
        uploaderId: "u-1",
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toThrow(/scan/i);
    expect(adapterRecords).toHaveLength(0);
  });

  it("indeterminate verdict + default keep policy: stores normally with verdict surfaced", async () => {
    const adapterRecords: FakeStoredEntry[] = [];
    const adapter = fakeAdapter(adapterRecords);
    const storage = fakeStorage();
    const indeterminate: FileScanner = {
      async scan() {
        return { verdict: "indeterminate" };
      },
    };

    const svc = FileService.withStorageAdapter(storage, adapter);
    svc.fileScanner = indeterminate;

    const record = await svc.uploadAndCreate({
      tenantId: "t-1",
      folderId: null,
      filename: "unknown.bin",
      mimeType: "application/octet-stream",
      uploaderId: "u-1",
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(record.storageKey).not.toContain("_quarantine/");
    expect(record.scanVerdict).toBe("indeterminate");
    expect(adapterRecords).toHaveLength(1);
  });

  it("missing scanner = backward-compat (no-op): stores normally, no verdict surfaced", async () => {
    const adapterRecords: FakeStoredEntry[] = [];
    const adapter = fakeAdapter(adapterRecords);
    const storage = fakeStorage();

    const svc = FileService.withStorageAdapter(storage, adapter);
    // No svc.fileScanner — backward-compat path.

    const record = await svc.uploadAndCreate({
      tenantId: "t-1",
      folderId: null,
      filename: "noscan.bin",
      mimeType: "application/octet-stream",
      uploaderId: "u-1",
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(record.storageKey).not.toContain("_quarantine/");
    expect(record.scanVerdict).toBeUndefined();
    expect(adapterRecords).toHaveLength(1);
  });
});
