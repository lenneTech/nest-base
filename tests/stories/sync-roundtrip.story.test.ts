import { describe, expect, it } from "vitest";

import { planSyncFromTemplate } from "../../src/core/setup/sync-from-template.js";
import { planSyncToTemplate } from "../../src/core/setup/sync-to-template.js";

/**
 * Story · Two-way sync round-trip (SC.DX.04).
 *
 * The PRD's `SC.DX.04` requires that the two-way sync flow works:
 * `bun run sync:to-template` exports local `src/core/` changes,
 * `/upstream-pr` lands them upstream, and a downstream
 * `bun run sync:from-template` re-applies them cleanly.
 *
 * The round-trip the planners model:
 *   1. Local fork has its own `src/core/` (some files modified +
 *      some new ones the upstream doesn't have yet).
 *   2. `planSyncToTemplate` produces `add`/`modify` entries describing
 *      every change.
 *   3. The "upstream" applies those changes (its template snapshot
 *      ends up matching the local fork).
 *   4. A downstream consumer's `planSyncFromTemplate` against the
 *      *new* template snapshot produces operations that bring its
 *      tree to the same shape — convergent + idempotent.
 *
 * The simulation uses pure planners on string-keyed maps; no
 * filesystem, no network. The contract this slice locks: the
 * round-trip is convergent and a fully-synced tree produces zero ops.
 */
describe("Story · Two-way sync round-trip (SC.DX.04)", () => {
  it("after sync:to + apply + sync:from, a downstream tree converges with zero ops", () => {
    // Step 1: local fork's view of src/core/.
    const local: Record<string, string> = {
      "src/core/auth.ts": "const auth = 'updated'",
      "src/core/logger.ts": "const logger = 'unchanged'",
      "src/core/new-feature.ts": "// added by local fork",
    };
    // Step 1: original upstream snapshot (what the local fork pulled from).
    const originalUpstream: Record<string, string> = {
      "src/core/auth.ts": "const auth = 'old'",
      "src/core/logger.ts": "const logger = 'unchanged'",
    };

    // Step 2: local fork submits sync:to-template patch.
    const toPlan = planSyncToTemplate({
      local,
      templateCore: originalUpstream,
    });
    // Should produce: 1 modify (auth.ts) + 1 add (new-feature.ts) + 1 skip (logger).
    expect(toPlan.summary.add).toBe(1);
    expect(toPlan.summary.modify).toBe(1);
    expect(toPlan.summary.skip).toBe(1);
    expect(toPlan.summary.remove).toBe(0);

    // Step 3: upstream applies the patch — the new template
    // snapshot is just the local snapshot (since the patch carries
    // every difference).
    const newUpstream = local;

    // Step 4: a *fresh* downstream consumer pulls from the new
    // template. Their starting state matches the original upstream.
    const downstreamLocal: Record<string, string> = { ...originalUpstream };
    const fromPlan = planSyncFromTemplate({
      local: downstreamLocal,
      templateCore: newUpstream,
    });
    // Should produce: 1 update (auth.ts modified) + 1 create (new-feature.ts added).
    expect(fromPlan.summary.create).toBe(1);
    expect(fromPlan.summary.update).toBe(1);

    // Step 5: simulate downstream applying those operations. The
    // downstream's local tree should now mirror the new upstream.
    const downstreamAfter: Record<string, string> = { ...downstreamLocal };
    for (const write of [...fromPlan.create, ...fromPlan.update]) {
      downstreamAfter[write.path] = write.content;
    }
    for (const path of fromPlan.delete) {
      delete downstreamAfter[path];
    }
    expect(downstreamAfter).toEqual(newUpstream);
  });

  it("a fully-synced downstream produces zero operations on a re-sync (idempotent)", () => {
    const inSync: Record<string, string> = {
      "src/core/a.ts": "// a",
      "src/core/b.ts": "// b",
    };
    const fromPlan = planSyncFromTemplate({
      local: inSync,
      templateCore: inSync,
    });
    expect(fromPlan.summary.create + fromPlan.summary.update + fromPlan.summary.delete).toBe(0);
    expect(fromPlan.summary.skip).toBe(2);

    const toPlan = planSyncToTemplate({
      local: inSync,
      templateCore: inSync,
    });
    expect(toPlan.summary.add + toPlan.summary.modify + toPlan.summary.remove).toBe(0);
    expect(toPlan.summary.skip).toBe(2);
  });

  it("never touches src/modules/ in either direction", () => {
    const local: Record<string, string> = {
      "src/core/auth.ts": "core",
      "src/modules/widgets.ts": "user-domain",
    };
    const template: Record<string, string> = {
      "src/core/auth.ts": "core",
    };

    const fromPlan = planSyncFromTemplate({ local, templateCore: template });
    for (const w of [...fromPlan.create, ...fromPlan.update]) {
      expect(w.path.startsWith("src/modules/")).toBe(false);
    }
    for (const path of [...fromPlan.skip, ...fromPlan.delete]) {
      expect(path.startsWith("src/modules/")).toBe(false);
    }

    const toPlan = planSyncToTemplate({ local, templateCore: template });
    for (const entry of [...toPlan.add, ...toPlan.modify]) {
      expect(entry.path.startsWith("src/modules/")).toBe(false);
    }
    for (const path of [...toPlan.skip, ...toPlan.remove]) {
      expect(path.startsWith("src/modules/")).toBe(false);
    }
  });

  it("renderUnifiedPatch produces a non-empty patch for modify entries", () => {
    const local: Record<string, string> = {
      "src/core/auth.ts": "line1\nline2-changed\nline3\n",
    };
    const templateCore: Record<string, string> = {
      "src/core/auth.ts": "line1\nline2\nline3\n",
    };
    const plan = planSyncToTemplate({ local, templateCore });
    expect(plan.summary.modify).toBe(1);
    const patch = plan.renderUnifiedPatch();
    expect(patch).toContain("src/core/auth.ts");
    expect(patch).toContain("line2-changed");
  });
});
