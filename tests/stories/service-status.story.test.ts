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

    it("nimmt Mailpit nur bei gesetzter URL auf", () => {
      const list = planServiceCandidates({
        ...baseInput,
        env_vars: { MAILPIT_WEB_URL: "http://localhost:8025" },
      });
      expect(list.find((c) => c.id === "mailpit")?.probeUrl).toBe("http://localhost:8025");
    });

    it("zeigt PowerSync nur, wenn das Feature aktiv UND die URL gesetzt ist", () => {
      const featureOff = planServiceCandidates({
        ...baseInput,
        env_vars: { POWERSYNC_URL: "http://localhost:8080" },
      });
      expect(featureOff.find((c) => c.id === "powersync")).toBeUndefined();

      const featureOnNoUrl = planServiceCandidates({
        ...baseInput,
        features: loadFeatures({ FEATURE_POWERSYNC_ENABLED: "true" }),
      });
      expect(featureOnNoUrl.find((c) => c.id === "powersync")).toBeUndefined();

      const both = planServiceCandidates({
        ...baseInput,
        features: loadFeatures({ FEATURE_POWERSYNC_ENABLED: "true" }),
        env_vars: { POWERSYNC_URL: "http://localhost:8080" },
      });
      expect(both.find((c) => c.id === "powersync")?.probeUrl).toBe("http://localhost:8080");
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

    it("markiert 5xx-Antworten als `down` (Service erreichbar aber kaputt)", async () => {
      // Spin a tiny http server that always returns 500.
      const { createServer } = await import("node:http");
      const server = createServer((_req, res) => {
        res.statusCode = 500;
        res.end("internal");
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as { port: number }).port;
      try {
        const [r] = await probeServices(
          [
            {
              id: "x",
              label: "X",
              category: "core",
              probeUrl: `http://127.0.0.1:${port}/health`,
            },
          ],
          { timeoutMs: 500 },
        );
        expect(r?.status).toBe("down");
        expect(r?.detail).toContain("HTTP 500");
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it("markiert 2xx als `up` mit statusCode", async () => {
      const { createServer } = await import("node:http");
      const server = createServer((_req, res) => {
        res.statusCode = 200;
        res.end("ok");
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as { port: number }).port;
      try {
        const [r] = await probeServices(
          [
            {
              id: "x",
              label: "X",
              category: "core",
              probeUrl: `http://127.0.0.1:${port}/health`,
            },
          ],
          { timeoutMs: 500 },
        );
        expect(r?.status).toBe("up");
        expect(r?.statusCode).toBe(200);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });
});
