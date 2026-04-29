import pino, { type Logger as PinoBase, type LoggerOptions } from "pino";

import type { AppEnv } from "../http/cookie-cors-config.js";

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

/**
 * Plain shape of a Pino log record (subset). Used by tests and by the
 * `sink` test-hook that bypasses pino's stdout transport.
 */
export interface LogRecord {
  level: number;
  time: number;
  name?: string;
  msg: string;
  context?: string;
  stack?: string;
  [key: string]: unknown;
}

export interface CreateLoggerOptions {
  env: AppEnv | "test";
  name: string;
  level?: LogLevel;
  /**
   * Test hook: when set, log records are routed to this sink instead of
   * pino's default stdout transport. The records are decoded plain objects
   * so tests can assert on shape without parsing JSON lines.
   */
  sink?: (record: LogRecord) => void;
}

export type Logger = PinoBase;

/**
 * Build a Pino logger.
 *
 * Level defaults: `debug` in development, `info` everywhere else, unless
 * the caller passes an explicit `level`. The OTel SDK adds trace-id /
 * span-id correlation automatically once it's running (see `initObservability`).
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const level: LogLevel = options.level ?? (options.env === "development" ? "debug" : "info");

  const base: LoggerOptions = {
    name: options.name,
    level,
  };

  if (options.sink) {
    return pino(base, sinkStream(options.sink));
  }

  return pino(base);
}

function sinkStream(sink: (r: LogRecord) => void): { write: (chunk: string) => void } {
  return {
    write(chunk: string): void {
      try {
        const parsed = JSON.parse(chunk) as LogRecord;
        sink(parsed);
      } catch {
        // ignore parse failures — keeps test sinks resilient
      }
    },
  };
}
