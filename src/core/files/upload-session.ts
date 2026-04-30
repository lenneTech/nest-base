import { uuidV7 } from "../uuid/uuid-v7.js";

/**
 * TUS upload-session state machine.
 *
 * Tracks the offset / status of resumable uploads. Storage stays
 * behind a tiny `UploadSessionStorage` interface so the unit suite
 * runs without a DB; the production binding sits next to the Prisma
 * adapter.
 *
 * State transitions:
 *   pending  → partial    (first appendChunk lands)
 *   partial  → complete   (offset reaches uploadLength)
 *   any      → (deleted)  (abort)
 *
 * The actual byte sink (writing chunks into the StorageAdapter) is
 * the controller's job; this module owns the state contract.
 */

export type UploadStatus = "pending" | "partial" | "complete";

export interface UploadSession {
  id: string;
  uploadLength: number;
  offset: number;
  mimeType: string;
  status: UploadStatus;
}

export interface UploadSessionStorage {
  insert(session: UploadSession): Promise<void>;
  get(id: string): Promise<UploadSession | null>;
  update(id: string, patch: Partial<UploadSession>): Promise<UploadSession | null>;
  delete(id: string): Promise<boolean>;
}

export interface UploadSessionManagerOptions {
  /** Hard cap that any single upload must stay under. */
  maxUploadBytes: number;
}

export class UploadSessionNotFoundError extends Error {
  constructor(id: string) {
    super(`upload session not found: ${id}`);
    this.name = "UploadSessionNotFoundError";
  }
}

export class UploadOffsetMismatchError extends Error {
  constructor(expected: number, actual: number) {
    super(`upload offset mismatch: expected ${expected}, got ${actual}`);
    this.name = "UploadOffsetMismatchError";
  }
}

export class UploadTooLargeError extends Error {
  constructor(public readonly limit: number) {
    super(`upload exceeds the configured limit of ${limit} bytes`);
    this.name = "UploadTooLargeError";
  }
}

export interface CreateSessionInput {
  uploadLength: number;
  mimeType: string;
}

export class UploadSessionManager {
  constructor(
    private readonly storage: UploadSessionStorage,
    private readonly options: UploadSessionManagerOptions,
  ) {}

  async create(input: CreateSessionInput): Promise<UploadSession> {
    if (input.uploadLength <= 0) {
      throw new Error(`upload length must be positive (received: ${input.uploadLength})`);
    }
    if (input.uploadLength > this.options.maxUploadBytes) {
      throw new UploadTooLargeError(this.options.maxUploadBytes);
    }
    const session: UploadSession = {
      id: uuidV7(),
      uploadLength: input.uploadLength,
      offset: 0,
      mimeType: input.mimeType,
      status: "pending",
    };
    await this.storage.insert(session);
    return session;
  }

  async appendChunk(id: string, offset: number, chunk: Uint8Array): Promise<UploadSession> {
    const session = await this.storage.get(id);
    if (!session) throw new UploadSessionNotFoundError(id);
    if (session.status === "complete") {
      throw new Error(`upload session ${id} is already complete`);
    }
    if (offset !== session.offset) {
      throw new UploadOffsetMismatchError(session.offset, offset);
    }
    const newOffset = session.offset + chunk.byteLength;
    if (newOffset > session.uploadLength) {
      throw new UploadTooLargeError(session.uploadLength);
    }
    const status: UploadStatus = newOffset === session.uploadLength ? "complete" : "partial";
    const updated = await this.storage.update(id, { offset: newOffset, status });
    if (!updated) throw new UploadSessionNotFoundError(id);
    return updated;
  }

  async get(id: string): Promise<UploadSession> {
    const session = await this.storage.get(id);
    if (!session) throw new UploadSessionNotFoundError(id);
    return session;
  }

  async abort(id: string): Promise<boolean> {
    return this.storage.delete(id);
  }
}
