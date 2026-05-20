import { describe, expect, it } from "vitest";

import { abilityAllows } from "../../src/core/permissions/ability-subject-access.js";
import { buildAbility } from "../../src/core/permissions/casl-ability.js";

describe("Story · ability-subject-access", () => {
  it("expanded manage:all allows @Can(manage, EmailOutboxAdmin)", () => {
    const ability = buildAbility([
      { action: "create", subject: "all" },
      { action: "read", subject: "all" },
      { action: "update", subject: "all" },
      { action: "delete", subject: "all" },
    ]);
    expect(abilityAllows(ability, "manage", "EmailOutboxAdmin")).toBe(true);
  });

  it("expanded manage on a subject allows manage checks for that subject", () => {
    const ability = buildAbility([
      { action: "create", subject: "EmailOutboxAdmin" },
      { action: "read", subject: "EmailOutboxAdmin" },
      { action: "update", subject: "EmailOutboxAdmin" },
      { action: "delete", subject: "EmailOutboxAdmin" },
    ]);
    expect(abilityAllows(ability, "manage", "EmailOutboxAdmin")).toBe(true);
  });
});
