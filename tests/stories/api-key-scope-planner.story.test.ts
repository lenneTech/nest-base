import { describe, expect, it } from "vitest";

import {
  ApiKeyScopeError,
  restrictAbilityByScopes,
  scopesToAbilityRules,
  validateApiKeyScopes,
} from "../../src/core/auth/api-keys/api-key-scope-planner.js";
import { buildAbility } from "../../src/core/permissions/casl-ability.js";

describe("Story · API-key scope planner", () => {
  it("maps read:profile to read UserProfile rules", () => {
    expect(scopesToAbilityRules(["read:profile"])).toEqual([
      { action: "read", subject: "UserProfile" },
    ]);
  });

  it("maps files:write to manage File", () => {
    expect(scopesToAbilityRules(["files:write"])).toEqual([{ action: "manage", subject: "File" }]);
  });

  it("rejects unknown scopes at issuance", () => {
    expect(() => validateApiKeyScopes(["read:profile", "nope:thing"])).toThrow(ApiKeyScopeError);
  });

  it("intersects a broad user ability with a narrow key scope", () => {
    const full = buildAbility([{ action: "manage", subject: "Example" }]);
    const restricted = restrictAbilityByScopes(full, ["read:example"]);
    expect(restricted.can("read", "Example")).toBe(true);
    expect(restricted.can("delete", "Example")).toBe(false);
  });
});
