import { describe, expect, it } from "vitest";

import { TenantIsolationError } from "../../src/core/multi-tenancy/tenant-scope-error.js";

describe("Story · TenantIsolationError", () => {
  it("is a named Error for problem-details mapping", () => {
    const err = new TenantIsolationError("active organization required");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("TenantIsolationError");
    expect(err.message).toContain("active organization");
  });
});
