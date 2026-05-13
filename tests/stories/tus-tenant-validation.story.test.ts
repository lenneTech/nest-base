import { describe, expect, it, vi } from "vitest";

import {
  buildTusFinishHook,
  type TusFinishHookUpload,
  type TusHookRequest,
} from "../../src/core/files/tus-finish-hook.js";

/**
 * Story · TUS Tenant Validation (Fix 1.1 — CF.SEC.TUS.01)
 *
 * The TUS server runs outside the NestJS middleware stack, so
 * BetterAuthSessionMiddleware and TenantInterceptor are NOT invoked for
 * TUS requests. The `onUploadFinish` hook is the sole server-side
 * enforcement point that the Upload-Metadata `tenantId` matches the
 * authenticated session's tenant. This story tests that security boundary.
 */

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function fakeRequest(sessionTenantId: string | null | undefined, hasSession = true): TusHookRequest {
  const headers = new Headers({ cookie: "session=fake" });
  return {
    headers,
    // Stash the sessionTenantId so our fake auth can read it.
    _sessionTenantId: sessionTenantId,
    _hasSession: hasSession,
  } as unknown as TusHookRequest;
}

function fakeAuth(req: TusHookRequest) {
  const r = req as unknown as {
    _sessionTenantId?: string | null;
    _hasSession?: boolean;
  };
  return {
    api: {
      getSession: async ({ headers: _headers }: { headers: Headers }) => {
        if (!r._hasSession) return null;
        return {
          user: { id: "user-1", tenantId: r._sessionTenantId ?? null },
          session: {
            activeOrganizationId: r._sessionTenantId ?? null,
          },
        };
      },
    },
  };
}

function fakeFileService() {
  return {
    storageAdapter: {
      driverName: "memory",
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(new Uint8Array(0)),
    },
    insertRecord: vi.fn().mockResolvedValue(undefined),
  };
}

function fakeDataStore(bytes: Uint8Array = new Uint8Array([1, 2, 3])) {
  return {
    readBody: vi.fn().mockResolvedValue(bytes),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

function upload(tenantId: string): TusFinishHookUpload {
  return {
    id: "upload-123",
    metadata: {
      tenantId,
      filename: "test.txt",
      filetype: "text/plain",
      uploaderId: "user-1",
      folderId: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Story · TUS Tenant Validation (Fix 1.1)", () => {
  describe("when auth is wired", () => {
    it("allows an upload when metadata tenantId matches session tenantId", async () => {
      const TENANT = "11111111-1111-1111-1111-111111111111";
      const req = fakeRequest(TENANT);
      const auth = fakeAuth(req);
      const fileService = fakeFileService();
      const dataStore = fakeDataStore();

      const hook = buildTusFinishHook({
        fileService: fileService as never,
        dataStore: dataStore as never,
        auth: auth as never,
      });

      const result = await hook(req, upload(TENANT));

      // Success path: returns Upload-File-Id header (no status_code field).
      expect(result).not.toHaveProperty("status_code");
      expect(result.headers?.["Upload-File-Id"]).toBeDefined();
    });

    it("rejects with 403 when metadata tenantId differs from session tenantId", async () => {
      const SESSION_TENANT = "11111111-1111-1111-1111-111111111111";
      const SPOOFED_TENANT = "22222222-2222-2222-2222-222222222222";
      const req = fakeRequest(SESSION_TENANT);
      const auth = fakeAuth(req);
      const fileService = fakeFileService();
      const dataStore = fakeDataStore();

      const hook = buildTusFinishHook({
        fileService: fileService as never,
        dataStore: dataStore as never,
        auth: auth as never,
      });

      const result = await hook(req, upload(SPOOFED_TENANT));

      // The spoofed tenantId was rejected — file must NOT be persisted.
      expect((result as { status_code?: number }).status_code).toBe(403);
      expect(fileService.insertRecord).not.toHaveBeenCalled();
      expect(fileService.storageAdapter.put).not.toHaveBeenCalled();
    });

    it("rejects with 401 when there is no valid session", async () => {
      const TENANT = "11111111-1111-1111-1111-111111111111";
      const req = fakeRequest(null, /* hasSession */ false);
      const auth = fakeAuth(req);
      const fileService = fakeFileService();
      const dataStore = fakeDataStore();

      const hook = buildTusFinishHook({
        fileService: fileService as never,
        dataStore: dataStore as never,
        auth: auth as never,
      });

      const result = await hook(req, upload(TENANT));

      expect((result as { status_code?: number }).status_code).toBe(401);
      expect(fileService.insertRecord).not.toHaveBeenCalled();
    });
  });

  describe("when auth is not wired (backward-compat / dev mode)", () => {
    it("allows the upload without session validation when auth is null", async () => {
      const TENANT = "11111111-1111-1111-1111-111111111111";
      const req = fakeRequest(null, false);
      const fileService = fakeFileService();
      const dataStore = fakeDataStore();

      const hook = buildTusFinishHook({
        fileService: fileService as never,
        dataStore: dataStore as never,
        auth: null,
      });

      const result = await hook(req, upload(TENANT));

      expect(result).not.toHaveProperty("status_code");
      expect(result.headers?.["Upload-File-Id"]).toBeDefined();
    });
  });
});
