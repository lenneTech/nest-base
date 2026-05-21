import { describe, expect, it } from "vitest";

import type { Logger } from "../../src/core/observability/logger.js";
import { PinoLoggerService } from "../../src/core/observability/pino-logger.service.js";

/**
 * Story · PinoLoggerService — NestJS LoggerService → Pino bridge.
 *
 * Regression guard for the boot-failure DX bug: NestJS' internal
 * `ExceptionHandler` passes the thrown `Error` *object* to
 * `logger.error(...)` when module/DI initialisation fails. The previous
 * `format()` did `JSON.stringify(message)` for non-strings, and
 * `JSON.stringify(new Error("boom")) === "{}"` (Error's `message`/`stack`
 * are non-enumerable) — so the real cause was masked as `[ExceptionHandler] {}`.
 * It also threw on circular objects (`JSON.stringify` cycle error), which
 * would crash the logger itself.
 */

interface Captured {
  level: string;
  obj: unknown;
  msg: unknown;
}

function fakePino(): { logger: Logger; calls: Captured[] } {
  const calls: Captured[] = [];
  const at =
    (level: string) =>
    (obj: unknown, msg?: unknown): void => {
      calls.push({ level, obj, msg });
    };
  const logger = {
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    debug: at("debug"),
    trace: at("trace"),
  } as unknown as Logger;
  return { logger, calls };
}

describe("Story · PinoLoggerService", () => {
  it("forwards a string message unchanged with its context", () => {
    const { logger, calls } = fakePino();
    new PinoLoggerService(logger).log("hello", "Ctx");
    expect(calls[0]!.level).toBe("info");
    expect(calls[0]!.msg).toBe("hello");
    expect((calls[0]!.obj as { context?: string }).context).toBe("Ctx");
  });

  it("unmasks an Error passed to error() instead of logging '{}'", () => {
    const { logger, calls } = fakePino();
    new PinoLoggerService(logger).error(new Error("storage driver missing aws-sdk"));
    const call = calls[0]!;
    expect(call.level).toBe("error");
    // The real message must survive — JSON.stringify(error) === '{}' is the bug.
    expect(call.msg).toBe("storage driver missing aws-sdk");
    expect(call.msg).not.toBe("{}");
    // The stack is preserved in the structured field.
    expect((call.obj as { stack?: string }).stack).toContain("storage driver missing aws-sdk");
  });

  it("does not throw when a non-serialisable (circular) object is logged", () => {
    const { logger, calls } = fakePino();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => new PinoLoggerService(logger).log(circular)).not.toThrow();
    expect(typeof calls[0]!.msg).toBe("string");
  });
});
