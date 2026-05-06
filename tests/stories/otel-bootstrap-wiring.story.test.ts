import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { planOtelBootstrap } from "../../src/core/observability/otel-sdk-bootstrap.js";

/**
 * Story · OpenTelemetry SDK bootstrap wiring (TR.BE.16).
 *
 * The PRD pins `@opentelemetry/sdk-node` + auto-instrumentations as a
 * Technical Requirement. The infrastructure (`otel-sdk-bootstrap.ts`)
 * has long existed, but the audit (iter-60) found it was never called
 * from `bootstrap.ts` — auto-instrumentations require patching
 * HTTP/Prisma/Express modules BEFORE they are loaded, so the SDK has
 * to start before NestFactory.create().
 *
 * Iter-64 wires the call. This test locks both ends:
 *   - the planner returns the right plan for sane env input
 *   - bootstrap.ts contains the wiring that calls the planner +
 *     starts the SDK before `NestFactory.create()`
 */
const ROOT = resolve(__dirname, "..", "..");
const BOOTSTRAP_SOURCE = readFileSync(resolve(ROOT, "src/core/app/bootstrap.ts"), "utf8");

describe("Story · OTel SDK bootstrap wiring (TR.BE.16)", () => {
  describe("planner contract", () => {
    it("returns enabled=false when observability flag is off", () => {
      const plan = planOtelBootstrap({
        observabilityEnabled: false,
        otlpEndpoint: "http://collector:4318/v1/traces",
        serviceName: "test",
      });
      expect(plan.enabled).toBe(false);
    });

    it("returns enabled=false when OTLP endpoint is missing", () => {
      const plan = planOtelBootstrap({
        observabilityEnabled: true,
        otlpEndpoint: undefined,
        serviceName: "test",
      });
      expect(plan.enabled).toBe(false);
      if (!plan.enabled) {
        expect(plan.reason).toMatch(/endpoint/i);
      }
    });

    it("returns enabled=true with explicit serviceName when both are configured", () => {
      const plan = planOtelBootstrap({
        observabilityEnabled: true,
        otlpEndpoint: "http://collector:4318/v1/traces",
        serviceName: "my-service",
      });
      expect(plan.enabled).toBe(true);
      if (plan.enabled) {
        expect(plan.serviceName).toBe("my-service");
        expect(plan.otlpEndpoint).toBe("http://collector:4318/v1/traces");
      }
    });

    it("falls back to 'nest-base' when serviceName is empty/undefined", () => {
      const plan = planOtelBootstrap({
        observabilityEnabled: true,
        otlpEndpoint: "http://collector:4318/v1/traces",
        serviceName: undefined,
      });
      expect(plan.enabled).toBe(true);
      if (plan.enabled) {
        expect(plan.serviceName).toBe("nest-base");
      }
    });
  });

  describe("bootstrap.ts wiring", () => {
    it("imports `planOtelBootstrap` and `createOtelSdk` from the otel-sdk-bootstrap module", () => {
      expect(BOOTSTRAP_SOURCE).toMatch(
        /import\s*\{[^}]*planOtelBootstrap[^}]*\}\s*from\s*["']\.\.\/observability\/otel-sdk-bootstrap\.js["']/,
      );
      expect(BOOTSTRAP_SOURCE).toMatch(
        /import\s*\{[^}]*createOtelSdk[^}]*\}\s*from\s*["']\.\.\/observability\/otel-sdk-bootstrap\.js["']/,
      );
    });

    it("calls `planOtelBootstrap(...)` somewhere in the bootstrap flow", () => {
      expect(BOOTSTRAP_SOURCE).toMatch(/planOtelBootstrap\s*\(/);
    });

    it("calls `sdk.start()` on the constructed SDK", () => {
      expect(BOOTSTRAP_SOURCE).toMatch(/sdk\.start\(\)/);
    });

    it("the SDK start happens BEFORE `NestFactory.create()` so auto-instrumentations can patch", () => {
      const sdkStartIdx = BOOTSTRAP_SOURCE.indexOf("sdk.start()");
      // Use the actual call-site marker (`await NestFactory.create`) so
      // the assertion ignores doc-comments / import lines that mention
      // the API in passing.
      const nestFactoryCallIdx = BOOTSTRAP_SOURCE.indexOf("await NestFactory.create");
      expect(sdkStartIdx).toBeGreaterThan(0);
      expect(nestFactoryCallIdx).toBeGreaterThan(sdkStartIdx);
    });

    it("the SDK start is gated on `listen` so test boots skip the network exporter", () => {
      // Tests pass `listen: false`. Without the gate, every test would
      // try to push spans to the configured (or unconfigured) collector.
      const sdkBlock = BOOTSTRAP_SOURCE.split("sdk.start()")[0] ?? "";
      expect(sdkBlock).toMatch(/if\s*\(\s*listen\s*\)/);
    });

    it("references the OTLP env var so consumers know what to set", () => {
      expect(BOOTSTRAP_SOURCE).toContain("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT");
    });
  });
});
