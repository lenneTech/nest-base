import { describe, expect, it } from "vitest";

import { planPrismaStudio } from "../../src/core/dx/prisma-studio.js";

describe("Story · Prisma-Studio Launcher", () => {
  const baseUrl = "postgresql://u:p@localhost:5432/db";

  it("plant `bunx prisma studio` mit Port 5555 als Default", () => {
    const plan = planPrismaStudio({ env: "development", databaseUrl: baseUrl });
    expect(plan).toMatchObject({
      action: "spawn",
      command: "bunx",
      port: 5555,
      url: "http://localhost:5555",
    });
    if (plan.action === "spawn") {
      expect(plan.args).toContain("prisma");
      expect(plan.args).toContain("studio");
      expect(plan.args).toContain("--port");
      expect(plan.args).toContain("5555");
      expect(plan.args).toContain("--browser");
      expect(plan.args).toContain("none");
      expect(plan.args).toContain("--url");
      expect(plan.args).toContain(baseUrl);
    }
  });

  it("respektiert benutzerdefinierten Port und Config-Pfad", () => {
    const plan = planPrismaStudio({
      env: "development",
      port: 6000,
      configPath: "./custom.config.ts",
      databaseUrl: baseUrl,
    });
    if (plan.action !== "spawn") throw new Error("expected spawn");
    expect(plan.port).toBe(6000);
    expect(plan.url).toBe("http://localhost:6000");
    expect(plan.args).toContain("--config");
    expect(plan.args).toContain("./custom.config.ts");
  });

  it("skip wenn keine databaseUrl gesetzt ist", () => {
    expect(planPrismaStudio({ env: "development" })).toMatchObject({
      action: "skip",
      reason: expect.stringContaining("databaseUrl"),
    });
  });

  it("skip außerhalb von dev", () => {
    expect(planPrismaStudio({ env: "production", databaseUrl: baseUrl })).toMatchObject({
      action: "skip",
      reason: expect.stringContaining("production"),
    });
    expect(planPrismaStudio({ env: "test", databaseUrl: baseUrl })).toMatchObject({
      action: "skip",
    });
  });

  it("skip mit PRISMA_STUDIO=0", () => {
    expect(
      planPrismaStudio({
        env: "development",
        databaseUrl: baseUrl,
        env_vars: { PRISMA_STUDIO: "0" },
      }),
    ).toMatchObject({ action: "skip", reason: expect.stringContaining("PRISMA_STUDIO") });
  });

  it("skip unter CI", () => {
    expect(
      planPrismaStudio({
        env: "development",
        databaseUrl: baseUrl,
        env_vars: { CI: "true" },
      }),
    ).toMatchObject({ action: "skip", reason: expect.stringContaining("CI") });
  });

  it("validiert Port-Range", () => {
    expect(() => planPrismaStudio({ env: "development", databaseUrl: baseUrl, port: 0 })).toThrow(
      /port/,
    );
    expect(() =>
      planPrismaStudio({ env: "development", databaseUrl: baseUrl, port: 99_999 }),
    ).toThrow(/port/);
  });
});
