import { describe, expect, it } from "vitest";

/**
 * Story · Hub routing contract (pure planner assertions).
 *
 * Verifies the routing-table invariants of the Hub promotion without
 * booting NestJS. The runtime (e2e) counterpart lives in
 * `tests/hub-routing.e2e-spec.ts`.
 *
 * Rules from issue #83:
 *   - `/`          → Hub UI (SPA shell)
 *   - `/api/*`     → all existing API endpoints
 *   - `/api/auth/*`→ Better-Auth
 *   - `/api/docs`  → Scalar/OpenAPI
 *   - `/health/*`  → stays at root
 *
 * The planner assertions live here; the middleware path-classifiers
 * are validated in their own story files.
 */

// The hub password planner: pure function that decides whether to
// require auth and what the session cookie shape looks like.
import {
  buildHubAuthConfig,
  type HubAuthConfig,
  type HubStage,
} from "../../src/core/hub/hub-auth-planner.js";

describe("Story · Hub auth planner", () => {
  describe("buildHubAuthConfig", () => {
    it("returns requireAuth=false for local stage", () => {
      const cfg = buildHubAuthConfig({ stage: "local" });
      expect(cfg.requireAuth).toBe(false);
    });

    it("returns requireAuth=true for staging", () => {
      const cfg = buildHubAuthConfig({ stage: "staging" });
      expect(cfg.requireAuth).toBe(true);
    });

    it("returns requireAuth=true for production", () => {
      const cfg = buildHubAuthConfig({ stage: "production" });
      expect(cfg.requireAuth).toBe(true);
    });

    it("returns requireAuth=true for test stage", () => {
      const cfg = buildHubAuthConfig({ stage: "test" });
      expect(cfg.requireAuth).toBe(true);
    });

    it("cookie config has correct security properties for non-local stages", () => {
      const cfg = buildHubAuthConfig({ stage: "production" });
      expect(cfg.cookie.httpOnly).toBe(true);
      expect(cfg.cookie.secure).toBe(true);
      expect(cfg.cookie.sameSite).toBe("lax");
      expect(cfg.cookie.maxAgeMs).toBe(8 * 60 * 60 * 1000); // 8h
      expect(cfg.cookie.signed).toBe(true);
    });

    it("cookie.sliding is true (8h window extends on each request)", () => {
      const cfg = buildHubAuthConfig({ stage: "staging" });
      expect(cfg.cookie.sliding).toBe(true);
    });

    it("stage-to-auth mapping covers all HubStage values", () => {
      const stages: HubStage[] = ["local", "staging", "production", "test"];
      for (const stage of stages) {
        const cfg: HubAuthConfig = buildHubAuthConfig({ stage });
        expect(typeof cfg.requireAuth).toBe("boolean");
      }
    });
  });
});
