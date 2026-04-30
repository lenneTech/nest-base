import { describe, expect, it } from "vitest";

import { buildKubbConfig, type KubbConfigInput } from "../../src/core/dx/kubb-config.js";

/**
 * Story · kubb config builder.
 *
 * Pure builder for the config object kubb's CLI consumes. The
 * top-level `kubb.config.ts` calls this builder with the project's
 * OpenAPI source + output dir; the builder fills in the right
 * plugin set (typescript types + fetch client) so a fresh project
 * gets a working SDK without copy-pasting kubb plumbing.
 *
 * Tests stay schema-level — verifying the config shape kubb expects
 * without invoking the CLI.
 */
describe("Story · kubb config builder", () => {
  function input(overrides: Partial<KubbConfigInput> = {}): KubbConfigInput {
    return {
      specPath: "./openapi.json",
      outputDir: "./generated/sdk",
      ...overrides,
    };
  }

  describe("top-level shape", () => {
    it("passes specPath through as `input.path`", () => {
      const cfg = buildKubbConfig(input({ specPath: "./spec/api.yaml" }));
      expect(cfg.input.path).toBe("./spec/api.yaml");
    });

    it("passes outputDir through as `output.path`", () => {
      const cfg = buildKubbConfig(input({ outputDir: "./sdk-out" }));
      expect(cfg.output.path).toBe("./sdk-out");
    });

    it("rejects an empty specPath", () => {
      expect(() => buildKubbConfig(input({ specPath: "" }))).toThrow(/specPath/i);
    });

    it("rejects an empty outputDir", () => {
      expect(() => buildKubbConfig(input({ outputDir: "" }))).toThrow(/outputDir/i);
    });
  });

  describe("plugins", () => {
    it("includes the typescript plugin by default", () => {
      const cfg = buildKubbConfig(input());
      const names = cfg.plugins.map((p) => p.name);
      expect(names).toContain("@kubb/plugin-oas");
      expect(names).toContain("@kubb/plugin-ts");
    });

    it("includes the fetch-client plugin by default", () => {
      const cfg = buildKubbConfig(input());
      expect(cfg.plugins.map((p) => p.name)).toContain("@kubb/plugin-client");
    });

    it("keeps plugin order deterministic — oas first (others depend on it)", () => {
      const cfg = buildKubbConfig(input());
      const names = cfg.plugins.map((p) => p.name);
      expect(names.indexOf("@kubb/plugin-oas")).toBeLessThan(names.indexOf("@kubb/plugin-ts"));
      expect(names.indexOf("@kubb/plugin-oas")).toBeLessThan(names.indexOf("@kubb/plugin-client"));
    });
  });

  describe("overrides", () => {
    it("passes a custom client.importPath through", () => {
      const cfg = buildKubbConfig(input({ clientImportPath: "./shared/http-client.ts" }));
      const client = cfg.plugins.find((p) => p.name === "@kubb/plugin-client");
      expect((client?.options as { importPath?: string } | undefined)?.importPath).toBe(
        "./shared/http-client.ts",
      );
    });

    it("forwards a baseURL when provided", () => {
      const cfg = buildKubbConfig(input({ baseURL: "https://api.example.com" }));
      const client = cfg.plugins.find((p) => p.name === "@kubb/plugin-client");
      expect((client?.options as { baseURL?: string } | undefined)?.baseURL).toBe(
        "https://api.example.com",
      );
    });
  });

  describe("determinism", () => {
    it("returns byte-identical config for byte-identical input", () => {
      const a = buildKubbConfig(input());
      const b = buildKubbConfig(input());
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it("returns a fresh object every call (no shared mutation)", () => {
      const a = buildKubbConfig(input());
      const b = buildKubbConfig(input());
      expect(a).not.toBe(b);
      expect(a.plugins).not.toBe(b.plugins);
    });
  });
});
