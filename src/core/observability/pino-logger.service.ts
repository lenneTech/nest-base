import { Injectable, type LoggerService } from "@nestjs/common";

import type { Logger } from "./logger.js";

/**
 * Bridges NestJS' `LoggerService` interface into a Pino logger.
 *
 * NestJS calls `log/warn/error/debug/verbose(message, context?)` from its
 * built-in logging hooks; we translate the level names and forward to
 * Pino with the optional `context` carried as a structured field.
 */
@Injectable()
export class PinoLoggerService implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, context?: string): void {
    this.logger.info({ context }, this.format(message));
  }

  warn(message: unknown, context?: string): void {
    this.logger.warn({ context }, this.format(message));
  }

  error(message: unknown, stack?: string, context?: string): void {
    // NestJS' ExceptionHandler passes the thrown Error *object* here on
    // module/DI/bootstrap failures. `JSON.stringify(error) === "{}"`
    // (Error's message/stack are non-enumerable), which silently masked
    // the real cause as `[ExceptionHandler] {}`. Unwrap the Error so its
    // message becomes the log message and its stack is preserved.
    if (message instanceof Error) {
      this.logger.error({ context, stack: stack ?? message.stack }, message.message);
      return;
    }
    this.logger.error({ context, stack }, this.format(message));
  }

  debug(message: unknown, context?: string): void {
    this.logger.debug({ context }, this.format(message));
  }

  verbose(message: unknown, context?: string): void {
    this.logger.trace({ context }, this.format(message));
  }

  private format(message: unknown): string {
    if (typeof message === "string") return message;
    if (message instanceof Error) return message.message;
    try {
      return JSON.stringify(message);
    } catch {
      // Circular / BigInt / other non-serialisable payloads must never
      // crash the logger — fall back to a best-effort string.
      return String(message);
    }
  }
}
