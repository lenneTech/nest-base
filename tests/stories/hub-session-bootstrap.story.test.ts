import { describe, expect, it } from "vitest";

import { pickDefaultOrganizationId } from "../../src/core/dx/clients/lib/hub-session-bootstrap.js";

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
