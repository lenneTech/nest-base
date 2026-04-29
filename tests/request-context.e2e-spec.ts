import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrap } from '../src/core/app/bootstrap.js';

/**
 * RequestContextMiddleware registration check.
 *
 * The middleware exists as `@Injectable() RequestContextMiddleware`
 * and emits `x-request-id` + `traceparent` response headers. We pin
 * registration here — without `MiddlewareConsumer.apply(...)` in the
 * AppModule's `configure()` hook, no headers are emitted.
 */
describe('RequestContext · middleware wiring', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootstrap({ listen: false, logger: { log() {}, warn() {}, error() {}, debug() {}, verbose() {} } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET / sets an x-request-id response header', async () => {
    const res = await request(app.getHttpServer()).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{8,}$/i);
  });

  it('GET / sets a W3C traceparent response header', async () => {
    const res = await request(app.getHttpServer()).get('/');
    // Format: 00-<32-hex-trace>-<16-hex-parent>-<2-hex-flags>
    expect(res.headers['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  });

  it('echoes an upstream traceparent (continues distributed trace)', async () => {
    const upstream = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';
    const res = await request(app.getHttpServer()).get('/').set('traceparent', upstream);
    expect(res.status).toBe(200);
    // Trace id must match the upstream value (parent id may change).
    expect(res.headers['traceparent']).toMatch(/^00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-/);
  });

  it('mints a new trace id when none is provided', async () => {
    const res = await request(app.getHttpServer()).get('/');
    expect(res.headers['traceparent']).not.toMatch(/^00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-/);
  });
});
