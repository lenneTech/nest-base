import { describe, expect, it } from 'vitest';

import { bootstrap } from '../src/core/app/bootstrap.js';
import { createLogger, type LogRecord } from '../src/core/observability/logger.js';
import { PinoLoggerService } from '../src/core/observability/pino-logger.service.js';

/**
 * Bootstrap routes NestJS' built-in logger output (route discovery,
 * module resolution, lifecycle hooks) through PinoLoggerService.
 * Caller can inject a custom logger for testing — that lets us pin the
 * contract here without scraping stdout in vitest.
 */
describe('bootstrap() · Pino logger wiring', () => {
  it('emits at least one log line during boot when a logger is injected', async () => {
    const records: LogRecord[] = [];
    const pino = createLogger({
      env: 'development',
      name: 'test-server',
      sink: (r) => records.push(r),
    });
    const logger = new PinoLoggerService(pino);

    const app = await bootstrap({ listen: false, logger });
    try {
      // NestJS emits "RoutesResolver"/"RouterExplorer"/"NestApplication"
      // log lines during init() — at minimum one record is expected.
      expect(records.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('NestJS lifecycle messages flow through the injected logger (not stdout)', async () => {
    const records: LogRecord[] = [];
    const pino = createLogger({
      env: 'development',
      name: 'lifecycle-test',
      sink: (r) => records.push(r),
    });
    const logger = new PinoLoggerService(pino);

    const app = await bootstrap({ listen: false, logger });
    try {
      // The Nest init log lines have a `context` field set to the
      // emitter (e.g. "NestFactory", "InstanceLoader"); our service
      // forwards it as a structured field.
      const withContext = records.filter((r) => typeof r.context === 'string');
      expect(withContext.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('default bootstrap (no injected logger) still constructs without error', async () => {
    // Smoke: when no logger is injected, bootstrap() builds a Pino
    // logger itself. We just verify it doesn't throw — actual stdout
    // output is observable in `bun run dev`.
    const app = await bootstrap({ listen: false });
    await app.close();
  });
});
