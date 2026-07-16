import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bootstrapHubOperatorSession,
  pickDefaultOrganizationId,
} from "../../src/core/dx/clients/lib/hub-session-bootstrap.js";

describe("Story · pickDefaultOrganizationId()", () => {
  it("prefers the seeded lenne org when present", () => {
    const id = pickDefaultOrganizationId([
      { id: "other", slug: "acme" },
      { id: "lenne-id", slug: "lenne" },
    ]);
    expect(id).toBe("lenne-id");
  });

  it("falls back to the first org", () => {
    const id = pickDefaultOrganizationId([{ id: "only", slug: "solo" }]);
    expect(id).toBe("only");
  });
});

describe("Story · bootstrapHubOperatorSession()", () => {
  // Each case owns its own fetch fake (tests/CLAUDE.md: per-test fakes).
  let fetchMock: ReturnType<typeof vi.fn>;

  const jsonResponse = (body: unknown, ok = true): Response =>
    ({ ok, json: async () => body }) as unknown as Response;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("MULTI-TENANT: lists orgs, set-actives the default, returns its id (path unchanged)", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/auth/organization/list") {
        return Promise.resolve(jsonResponse([{ id: "org-1", slug: "lenne" }]));
      }
      if (url === "/api/auth/organization/set-active") {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await bootstrapHubOperatorSession();

    expect(result).toBe("org-1");
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toContain("/api/auth/organization/set-active");
    // Multi-tenant path must NOT consult the single-tenant probe.
    expect(urls).not.toContain("/hub/operator-tenant.json");
  });

  it("SINGLE-TENANT: org/list 404 → resolves tenant via /hub/operator-tenant.json", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/auth/organization/list") {
        return Promise.resolve(jsonResponse({}, false)); // 404 — org plugin off
      }
      if (url === "/hub/operator-tenant.json") {
        return Promise.resolve(jsonResponse({ tenantId: "tenant-abc" }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await bootstrapHubOperatorSession();

    expect(result).toBe("tenant-abc");
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toContain("/hub/operator-tenant.json");
    // No set-active in single-tenant mode (the org plugin does not exist).
    expect(urls).not.toContain("/api/auth/organization/set-active");
  });

  it("SINGLE-TENANT: empty org list also falls back to the operator-tenant probe", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/auth/organization/list") {
        return Promise.resolve(jsonResponse([])); // ok but empty
      }
      if (url === "/hub/operator-tenant.json") {
        return Promise.resolve(jsonResponse({ tenantId: "tenant-xyz" }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await bootstrapHubOperatorSession();

    expect(result).toBe("tenant-xyz");
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain("/hub/operator-tenant.json");
  });

  it("SINGLE-TENANT: no membership (tenantId null) → undefined (no blind fallback)", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/auth/organization/list") {
        return Promise.resolve(jsonResponse({}, false));
      }
      if (url === "/hub/operator-tenant.json") {
        return Promise.resolve(jsonResponse({ tenantId: null }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await bootstrapHubOperatorSession();

    expect(result).toBeUndefined();
  });

  it("SINGLE-TENANT: probe failure returns undefined (no throw)", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/auth/organization/list") {
        return Promise.resolve(jsonResponse({}, false));
      }
      if (url === "/hub/operator-tenant.json") {
        return Promise.resolve(jsonResponse({}, false));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await expect(bootstrapHubOperatorSession()).resolves.toBeUndefined();
  });
});
