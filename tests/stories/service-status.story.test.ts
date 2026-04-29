import { describe, expect, it } from "vitest";

import { planServiceCandidates, probeServices } from "../../src/core/dx/service-status.js";
import { loadFeatures } from "../../src/core/features/features.js";

const baseInput = {
  baseUrl: "http://localhost:3000",
  features: loadFeatures({}),
};

describe("Story · Service-Status", () => {
  describe("planServiceCandidates", () => {
    it("listet API + Postgres immer als Core-Kandidaten", () => {
      const list = planServiceCandidates(baseInput);
      const ids = list.map((c) => c.id);
      expect(ids).toContain("api");
      expect(ids).toContain("database");
      expect(list.find((c) => c.id === "api")?.category).toBe("core");
    });

    it("nimmt Prisma Studio nur auf, wenn DATABASE_URL gesetzt und PRISMA_STUDIO != 0", () => {
      const without = planServiceCandidates(baseInput);
      expect(without.find((c) => c.id === "prisma-studio")).toBeUndefined();

      const with_db = planServiceCandidates({
        ...baseInput,
        env_vars: { DATABASE_URL: "postgresql://x" },
      });
      expect(with_db.find((c) => c.id === "prisma-studio")?.probeUrl).toBe("http://localhost:5555");

      const opted_out = planServiceCandidates({
        ...baseInput,
        env_vars: { DATABASE_URL: "postgresql://x", PRISMA_STUDIO: "0" },
      });
      expect(opted_out.find((c) => c.id === "prisma-studio")).toBeUndefined();
    });

    it("nimmt NestJS DevTools auf — opt-out via NESTJS_DEVTOOLS=0", () => {
      const def = planServiceCandidates(baseInput);
      expect(def.find((c) => c.id === "nest-devtools")?.probeUrl).toBe("http://localhost:8000");

      const off = planServiceCandidates({ ...baseInput, env_vars: { NESTJS_DEVTOOLS: "0" } });
      expect(off.find((c) => c.id === "nest-devtools")).toBeUndefined();
    });

    it("nimmt Mailpit + PowerSync nur bei gesetzten URLs auf", () => {
      const list = planServiceCandidates({
        ...baseInput,
        env_vars: {
          MAILPIT_WEB_URL: "http://localhost:8025",
          POWERSYNC_URL: "http://localhost:8080",
        },
      });
      expect(list.find((c) => c.id === "mailpit")?.probeUrl).toBe("http://localhost:8025");
      expect(list.find((c) => c.id === "powersync")?.probeUrl).toBe("http://localhost:8080");
    });
  });

  describe("probeServices", () => {
    it("liefert `unknown` wenn keine probeUrl gesetzt ist", async () => {
      const [r] = await probeServices([{ id: "x", label: "X", category: "tooling" }]);
      expect(r?.status).toBe("unknown");
    });

    it("liefert `down` für nicht erreichbare Hosts (kurzer Timeout)", async () => {
      // Port 1 ist reserved/kapselt sicher offline.
      const [r] = await probeServices(
        [{ id: "x", label: "X", category: "core", probeUrl: "http://127.0.0.1:1" }],
        { timeoutMs: 200 },
      );
      expect(r?.status).toBe("down");
      expect(typeof r?.latencyMs).toBe("number");
    });
  });
});
