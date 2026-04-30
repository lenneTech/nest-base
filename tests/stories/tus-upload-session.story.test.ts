import { describe, expect, it } from "vitest";

import {
  UploadSessionManager,
  UploadOffsetMismatchError,
  UploadSessionNotFoundError,
  UploadTooLargeError,
  type UploadSession,
  type UploadSessionStorage,
} from "../../src/core/files/upload-session.js";

/**
 * Story · Multipart / TUS Upload-Session State.
 *
 * The TUS protocol is HTTP-shaped (POST creates, HEAD reads offset,
 * PATCH appends bytes at the current offset, DELETE aborts). This
 * slice owns the in-process state machine the `@tus/server` v3
 * binding will consume — `appendChunk()` is the only place where
 * actual bytes flow. Storage lives behind `UploadSessionStorage`.
 */
describe("Story · Upload Session (TUS state machine)", () => {
  function makeStorage(): UploadSessionStorage & { sessions: Map<string, UploadSession> } {
    const sessions = new Map<string, UploadSession>();
    return {
      get sessions() {
        return sessions;
      },
      async insert(session) {
        sessions.set(session.id, session);
      },
      async get(id) {
        return sessions.get(id) ?? null;
      },
      async update(id, patch) {
        const existing = sessions.get(id);
        if (!existing) return null;
        const updated = { ...existing, ...patch };
        sessions.set(id, updated);
        return updated;
      },
      async delete(id) {
        return sessions.delete(id);
      },
    };
  }

  function asBytes(text: string): Uint8Array {
    return new TextEncoder().encode(text);
  }

  describe("create()", () => {
    it("returns a session with offset=0 and the requested upload length", async () => {
      const mgr = new UploadSessionManager(makeStorage(), { maxUploadBytes: 1024 });
      const session = await mgr.create({ uploadLength: 100, mimeType: "image/png" });
      expect(session.offset).toBe(0);
      expect(session.uploadLength).toBe(100);
      expect(session.status).toBe("pending");
      expect(session.id).toMatch(/[0-9a-f-]{36}/);
    });

    it("rejects an upload that exceeds maxUploadBytes", async () => {
      const mgr = new UploadSessionManager(makeStorage(), { maxUploadBytes: 50 });
      await expect(mgr.create({ uploadLength: 100, mimeType: "image/png" })).rejects.toThrow(
        UploadTooLargeError,
      );
    });

    it("rejects a non-positive upload length", async () => {
      const mgr = new UploadSessionManager(makeStorage(), { maxUploadBytes: 1024 });
      await expect(mgr.create({ uploadLength: 0, mimeType: "t/p" })).rejects.toThrow();
    });
  });

  describe("appendChunk()", () => {
    it("appends bytes at the current offset and bumps it", async () => {
      const mgr = new UploadSessionManager(makeStorage(), { maxUploadBytes: 1024 });
      const session = await mgr.create({ uploadLength: 11, mimeType: "t/p" });
      const after1 = await mgr.appendChunk(session.id, 0, asBytes("hello"));
      expect(after1.offset).toBe(5);
      expect(after1.status).toBe("partial");
      const after2 = await mgr.appendChunk(session.id, 5, asBytes(" world"));
      expect(after2.offset).toBe(11);
      expect(after2.status).toBe("complete");
    });

    it("throws UploadOffsetMismatchError when the client offset does not match", async () => {
      const mgr = new UploadSessionManager(makeStorage(), { maxUploadBytes: 1024 });
      const session = await mgr.create({ uploadLength: 10, mimeType: "t/p" });
      await mgr.appendChunk(session.id, 0, asBytes("hello"));
      await expect(mgr.appendChunk(session.id, 0, asBytes(" more"))).rejects.toThrow(
        UploadOffsetMismatchError,
      );
    });

    it("throws when the chunk would exceed the declared upload length", async () => {
      const mgr = new UploadSessionManager(makeStorage(), { maxUploadBytes: 1024 });
      const session = await mgr.create({ uploadLength: 5, mimeType: "t/p" });
      await expect(mgr.appendChunk(session.id, 0, asBytes("too long"))).rejects.toThrow(
        UploadTooLargeError,
      );
    });

    it("throws UploadSessionNotFoundError on an unknown id", async () => {
      const mgr = new UploadSessionManager(makeStorage(), { maxUploadBytes: 1024 });
      await expect(mgr.appendChunk("missing", 0, asBytes("x"))).rejects.toThrow(
        UploadSessionNotFoundError,
      );
    });

    it("rejects appending to a completed session", async () => {
      const mgr = new UploadSessionManager(makeStorage(), { maxUploadBytes: 1024 });
      const session = await mgr.create({ uploadLength: 5, mimeType: "t/p" });
      await mgr.appendChunk(session.id, 0, asBytes("hello"));
      await expect(mgr.appendChunk(session.id, 5, asBytes("!"))).rejects.toThrow(/complete/i);
    });
  });

  describe("get() / abort()", () => {
    it("get() returns the current session", async () => {
      const mgr = new UploadSessionManager(makeStorage(), { maxUploadBytes: 1024 });
      const session = await mgr.create({ uploadLength: 10, mimeType: "t/p" });
      const fetched = await mgr.get(session.id);
      expect(fetched.id).toBe(session.id);
    });

    it("get() throws on missing id", async () => {
      const mgr = new UploadSessionManager(makeStorage(), { maxUploadBytes: 1024 });
      await expect(mgr.get("missing")).rejects.toThrow(UploadSessionNotFoundError);
    });

    it("abort() removes the session and rejects subsequent appends", async () => {
      const mgr = new UploadSessionManager(makeStorage(), { maxUploadBytes: 1024 });
      const session = await mgr.create({ uploadLength: 5, mimeType: "t/p" });
      await mgr.abort(session.id);
      await expect(mgr.appendChunk(session.id, 0, asBytes("x"))).rejects.toThrow(
        UploadSessionNotFoundError,
      );
    });

    it("abort() returns false when the id was already gone", async () => {
      const mgr = new UploadSessionManager(makeStorage(), { maxUploadBytes: 1024 });
      expect(await mgr.abort("missing")).toBe(false);
    });
  });
});
