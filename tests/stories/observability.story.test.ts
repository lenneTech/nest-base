import { describe, expect, it, vi } from "vitest";

import {
  type LogRecord,
  PinoLoggerService,
  createLogger,
  initObservability,
} from "../../src/core/observability/index.js";

/**
 * Story · Pino-Logger + OpenTelemetry
 *
 * The server emits structured JSON logs with severity-aware levels and
 * trace-id correlation. Logs go through Pino, traces/metrics through the
 * OpenTelemetry SDK. In `test` and `development` we keep the OTel
 * exporters as no-ops so unit-tests do not need a collector.
 */
describe("Story · Pino logger + OpenTelemetry", () => {
  describe("createLogger()", () => {
    it("emits structured records with msg/level/time/name", () => {
      const records: LogRecord[] = [];
      const logger = createLogger({
        env: "production",
        name: "test-app",
        sink: (r) => records.push(r),
      });
      logger.info({ requestId: "abc" }, "hello world");
      expect(records).toHaveLength(1);
      const rec = records[0]!;
      expect(rec.msg).toBe("hello world");
      expect(rec.level).toBe(30); // pino info = 30
      expect(rec.name).toBe("test-app");
      expect(rec.time).toBeTypeOf("number");
      expect(rec.requestId).toBe("abc");
    });

    it("uses level=debug in development and level=info in production", () => {
      const dev = createLogger({ env: "development", name: "a" });
      const prod = createLogger({ env: "production", name: "a" });
      expect(dev.level).toBe("debug");
      expect(prod.level).toBe("info");
    });

    it("respects an explicit level override", () => {
      const logger = createLogger({ env: "production", name: "a", level: "warn" });
      expect(logger.level).toBe("warn");
    });

    it("drops records below the configured level", () => {
      const records: LogRecord[] = [];
      const logger = createLogger({ env: "production", name: "a", sink: (r) => records.push(r) });
      logger.debug("skipped");
      logger.info("kept");
      expect(records.map((r) => r.msg)).toEqual(["kept"]);
    });
  });

  describe("PinoLoggerService (NestJS LoggerService)", () => {
    it("routes log/warn/error/debug/verbose to the Pino instance at the right levels", () => {
      const records: LogRecord[] = [];
      const logger = createLogger({
        env: "production",
        name: "a",
        level: "trace",
        sink: (r) => records.push(r),
      });
      const svc = new PinoLoggerService(logger);

      svc.log("info-msg", "AppContext");
      svc.warn("warn-msg", "AppContext");
      svc.error("err-msg", undefined, "AppContext");
      svc.debug?.("debug-msg", "AppContext");
      svc.verbose?.("verbose-msg", "AppContext");

      const levels = records.map((r) => r.level);
      // pino: trace=10, debug=20, info=30, warn=40, error=50
      expect(levels).toEqual([30, 40, 50, 20, 10]);
      expect(records.every((r) => r.context === "AppContext")).toBe(true);
    });

    it("serializes Error stack into the error record", () => {
      const records: LogRecord[] = [];
      const logger = createLogger({ env: "production", name: "a", sink: (r) => records.push(r) });
      const svc = new PinoLoggerService(logger);
      const boom = new Error("boom");

      svc.error("failed", boom.stack, "AppContext");

      expect(records).toHaveLength(1);
      expect(records[0]!.stack).toContain("Error: boom");
    });
  });

  describe("initObservability()", () => {
    it("returns shutdown noop and skips real exporters when feature is off", async () => {
      const shutdown = await initObservability({
        enabled: false,
        env: "production",
        serviceName: "a",
      });
      expect(typeof shutdown).toBe("function");
      await expect(shutdown()).resolves.toBeUndefined();
    });

    it("returns shutdown noop in `test` environment regardless of enabled flag", async () => {
      const shutdown = await initObservability({ enabled: true, env: "test", serviceName: "a" });
      await expect(shutdown()).resolves.toBeUndefined();
    });

    it("boots the SDK once and shuts it down cleanly when enabled in non-test env", async () => {
      const startSpy = vi.fn(async () => {});
      const shutdownSpy = vi.fn(async () => {});
      const shutdown = await initObservability({
        enabled: true,
        env: "production",
        serviceName: "a",
        sdkFactory: () => ({ start: startSpy, shutdown: shutdownSpy }),
      });
      expect(startSpy).toHaveBeenCalledTimes(1);
      await shutdown();
      expect(shutdownSpy).toHaveBeenCalledTimes(1);
    });
  });
});
