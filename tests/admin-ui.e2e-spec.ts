import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrap } from '../src/core/app/bootstrap.js';

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
const TENANT = '11111111-1111-1111-1111-111111111111';

const ROUTES = [
  '/admin/permissions/test',
  '/admin/webhooks',
  '/admin/realtime',
  '/admin/audit',
  '/admin/search',
];

describe('Admin UIs · /admin/* HTML pages', () => {
  describe('in development mode', () => {
    let app: INestApplication;

    beforeAll(async () => {
      process.env.NODE_ENV = 'development';
      app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    });

    afterAll(async () => {
      await app.close();
      process.env.NODE_ENV = 'test';
    });

    for (const route of ROUTES) {
      it(`GET ${route} returns 200 HTML`, async () => {
        const res = await request(app.getHttpServer())
          .get(route)
          .set('x-tenant-id', TENANT);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/html/);
        expect(res.text).toMatch(/<html/i);
      });
    }
  });

  describe('outside development mode', () => {
    let app: INestApplication;

    beforeAll(async () => {
      process.env.NODE_ENV = 'production';
      app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    });

    afterAll(async () => {
      await app.close();
      process.env.NODE_ENV = 'test';
    });

    it('GET /admin/permissions/test 404s in production', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/permissions/test')
        .set('x-tenant-id', TENANT);
      expect(res.status).toBe(404);
    });
  });
});
