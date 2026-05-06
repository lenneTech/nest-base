import { describe, expect, it } from "vitest";

import { planStartupBanner } from "../../src/core/dx/startup-banner.js";

describe("Story · Startup-Banner", () => {
  it("listet Health, OpenAPI, Scalar und Admin-URLs", () => {
    const plan = planStartupBanner({
      env: "development",
      baseUrl: "http://localhost:3000",
      port: 3000,
      features: { scalarEnabled: true },
    });

    const flat = plan.sections.flatMap((s) => s.entries.map((e) => e.url));
    expect(flat).toContain("http://localhost:3000/health/live");
    expect(flat).toContain("http://localhost:3000/health/ready");
    expect(flat).toContain("http://localhost:3000/api/openapi.json");
    expect(flat).toContain("http://localhost:3000/api/docs");
    expect(flat).toContain("http://localhost:3000/api/admin/permissions/test");
    expect(flat).toContain("http://localhost:3000/api/admin/webhooks");
  });

  it("blendet Scalar-URL aus, wenn das Feature deaktiviert ist", () => {
    const plan = planStartupBanner({
      env: "production",
      baseUrl: "https://api.example.com",
      port: 443,
      features: { scalarEnabled: false },
    });

    const docsSection = plan.sections.find((s) => s.title === "Docs");
    expect(docsSection?.entries.some((e) => e.label === "Scalar UI")).toBe(false);
  });

  it("strippt trailing slash der Base-URL", () => {
    const plan = planStartupBanner({
      env: "development",
      baseUrl: "http://localhost:3000/",
      port: 3000,
      features: { scalarEnabled: true },
    });

    expect(plan.text).not.toContain("//health");
    expect(plan.text).toContain("http://localhost:3000/health/live");
  });

  it("zeigt Services-Sektion, wenn Mailpit/PowerSync/Prisma Studio aktiv sind", () => {
    const plan = planStartupBanner({
      env: "development",
      baseUrl: "http://localhost:3000",
      port: 3000,
      features: {
        scalarEnabled: true,
        prismaStudioUrl: "http://localhost:5555",
        mailpitUrl: "http://localhost:8025",
        powerSyncUrl: "http://localhost:8080",
      },
    });

    const services = plan.sections.find((s) => s.title === "Services");
    expect(services).toBeDefined();
    expect(services?.entries.map((e) => e.label)).toEqual([
      "Prisma Studio",
      "Mailpit",
      "PowerSync",
    ]);
  });

  it("enthält ANSI-Farben im Text-Output", () => {
    const plan = planStartupBanner({
      env: "development",
      baseUrl: "http://localhost:3000",
      port: 3000,
      features: { scalarEnabled: true },
    });

    expect(plan.text).toContain("\x1b[");
    expect(plan.text).toContain("Server erfolgreich gestartet");
    expect(plan.variant).toBe("hero");
  });

  describe("Restart-Variant — kompakter Banner für Watch-Reloads", () => {
    it('rendert eine kompakte "♻ code change"-Zeile bei variant="restart-watch"', () => {
      const plan = planStartupBanner({
        env: "development",
        baseUrl: "http://localhost:3000",
        port: 3000,
        variant: "restart-watch",
        timestamp: "12:34:56",
        features: { scalarEnabled: true },
      });

      // Kompakte Variante: keine vollen Sections, nur eine Restart-Zeile.
      expect(plan.sections).toHaveLength(0);
      expect(plan.variant).toBe("restart-watch");
      expect(plan.text).toContain("♻");
      expect(plan.text).toContain("code change");
      expect(plan.text).toContain("12:34:56");
      expect(plan.text).toContain("http://localhost:3000");
      // Hero-Banner-Wording fehlt in der kompakten Variante.
      expect(plan.text).not.toContain("Server erfolgreich gestartet");
    });

    it('rendert ".env change"-Banner bei variant="restart-env"', () => {
      const plan = planStartupBanner({
        env: "development",
        baseUrl: "http://localhost:3000",
        port: 3000,
        variant: "restart-env",
        timestamp: "12:34:56",
        features: { scalarEnabled: true },
      });

      expect(plan.variant).toBe("restart-env");
      expect(plan.text).toContain(".env change");
    });
  });

  describe("Tunnel-URL — surfacing den Cloudflare-Tunnel im Banner", () => {
    it("zeigt die Tunnel-URL als eigene Section bei aktivem --tunnel im Hero-Banner", () => {
      const plan = planStartupBanner({
        env: "development",
        baseUrl: "http://localhost:3000",
        port: 3000,
        features: {
          scalarEnabled: true,
          tunnelUrl: "https://example-cute-name-123.trycloudflare.com",
        },
      });

      const tunnel = plan.sections.find((s) => s.title === "Tunnel");
      expect(tunnel).toBeDefined();
      expect(tunnel?.entries[0]?.url).toBe("https://example-cute-name-123.trycloudflare.com");
      // The text output also includes the URL so users can copy it.
      expect(plan.text).toContain("https://example-cute-name-123.trycloudflare.com");
    });

    it("blendet Tunnel-Section aus, wenn keine URL übergeben wurde", () => {
      const plan = planStartupBanner({
        env: "development",
        baseUrl: "http://localhost:3000",
        port: 3000,
        features: { scalarEnabled: true },
      });

      expect(plan.sections.find((s) => s.title === "Tunnel")).toBeUndefined();
    });

    it("zeigt die Tunnel-URL im kompakten Restart-Banner", () => {
      const plan = planStartupBanner({
        env: "development",
        baseUrl: "http://localhost:3000",
        port: 3000,
        variant: "restart-env",
        timestamp: "12:34:56",
        features: {
          scalarEnabled: true,
          tunnelUrl: "https://orange-coast-42.trycloudflare.com",
        },
      });

      expect(plan.text).toContain("https://orange-coast-42.trycloudflare.com");
    });
  });
});
