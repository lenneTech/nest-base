import { describe, expect, it } from "vitest";

import {
  isHubCockpitPath,
  isHubPortalAccessProbePath,
  isHubPortalLoginPath,
  isHubPortalProtectedPath,
  isHubPortalStaticAsset,
  isTenantAdminPortalPath,
  prefersHubPortalLoginRedirect,
} from "../../src/core/hub/hub-portal-paths.js";
import { isPathProtected } from "../../src/core/auth/jwt-middleware.js";

describe("Story · Hub portal paths", () => {
  it("classifies static assets as public hub paths", () => {
    expect(isHubPortalStaticAsset("/hub/static/main.js")).toBe(true);
    expect(isHubPortalProtectedPath("/hub/static/main.js")).toBe(false);
    expect(isPathProtected("/hub/static/main.js")).toBe(false);
  });

  it("requires session for /hub and /admin HTML", () => {
    expect(isHubPortalProtectedPath("/hub")).toBe(true);
    expect(isHubPortalProtectedPath("/hub/features")).toBe(true);
    expect(isHubPortalProtectedPath("/admin/users")).toBe(true);
    expect(isPathProtected("/hub")).toBe(true);
    expect(isPathProtected("/admin/users")).toBe(true);
  });

  it("keeps / as login path", () => {
    expect(isHubPortalLoginPath("/")).toBe(true);
    expect(isPathProtected("/")).toBe(false);
  });

  it("marks portal-access.json as the SPA gate probe", () => {
    expect(isHubPortalAccessProbePath("/hub/portal-access.json")).toBe(true);
    expect(isHubCockpitPath("/hub/portal-access.json")).toBe(false);
  });

  it("splits hub cockpit vs tenant-admin surfaces", () => {
    expect(isHubCockpitPath("/hub/features")).toBe(true);
    expect(isTenantAdminPortalPath("/admin/users")).toBe(true);
    expect(isHubCockpitPath("/admin/users")).toBe(false);
  });

  it("prefers HTML redirect for unauthenticated hub navigation", () => {
    expect(
      prefersHubPortalLoginRedirect({
        path: "/hub/logs",
        method: "GET",
        acceptHeader: "text/html",
      }),
    ).toBe(true);
  });
});
