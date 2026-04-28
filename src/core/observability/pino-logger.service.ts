import { Injectable, type LoggerService } from '@nestjs/common';

import type { Logger } from './logger.js';

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
    this.logger.error({ context, stack }, this.format(message));
  }

  debug(message: unknown, context?: string): void {
    this.logger.debug({ context }, this.format(message));
  }

  verbose(message: unknown, context?: string): void {
    this.logger.trace({ context }, this.format(message));
  }

  private format(message: unknown): string {
    return typeof message === 'string' ? message : JSON.stringify(message);
  }
}
