import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrap } from '../src/core/app/bootstrap.js';

/**
 * Adapted from nest-server health-check tests.
 *
 * Two distinct endpoints per the standard k8s-style probe split:
 *   - /health/live  → process is alive; never queries dependencies.
 *                     Used by liveness probes — returning 200 always
 *                     unless the event loop is stuck or boot failed.
 *   - /health/ready → service can serve traffic; pings DB + critical
 *                     dependencies. Returning non-200 lets the LB drain
 *                     while the dependency is recovering.
 */
describe('Health endpoints', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootstrap({ listen: false });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('GET /health/live', () => {
    it('responds 200 with status=ok', async () => {
      const response = await request(app.getHttpServer()).get('/health/live').expect(200);
      expect(response.body).toMatchObject({ status: 'ok' });
    });

    it('returns JSON content-type', async () => {
      const response = await request(app.getHttpServer()).get('/health/live');
      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('does not include dependency check results (liveness ≠ readiness)', async () => {
      const response = await request(app.getHttpServer()).get('/health/live');
      expect(response.body.checks).toBeUndefined();
    });
  });

  describe('GET /health/ready', () => {
    it('responds 200 with status=ok and the database check passing', async () => {
      const response = await request(app.getHttpServer()).get('/health/ready').expect(200);
      expect(response.body).toMatchObject({
        status: 'ok',
        checks: { database: { status: 'ok' } },
      });
    });

    it('returns the database response time as a number', async () => {
      const response = await request(app.getHttpServer()).get('/health/ready');
      expect(response.body.checks.database.responseTimeMs).toBeTypeOf('number');
      expect(response.body.checks.database.responseTimeMs).toBeGreaterThanOrEqual(0);
    });
  });
});
