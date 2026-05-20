import { describe, expect, it } from "vitest";
import type { Request } from "express";

import { resolveHubRootRedirectTarget } from "../../src/core/hub/hub-root-redirect.js";

describe("Story · Hub root redirect", () => {
  it("returns null when Better-Auth is not registered", async () => {
    const app = { get: () => null };
    const target = await resolveHubRootRedirectTarget(app as never, {} as Request);
    expect(target).toBeNull();
  });
});
