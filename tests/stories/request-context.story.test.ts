import type { INestApplication } from '@nestjs/common';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  RequestContextMiddleware,
  getRequestContext,
  parseTraceparent,
  runWithRequestContext,
} from '../../src/core/request-context/index.js';

/**
 * Story · Request-Context (W3C Trace Context + AsyncLocalStorage)
 *
 * Every inbound request gets a request-context populated from the
 * incoming `traceparent` header (W3C-spec) — or freshly generated when
 * the header is absent. The context is stored in AsyncLocalStorage so
 * downstream services / interceptors / loggers read it without
 * threading the request through every signature.
 */
describe('Story · Request-Context (W3C Trace Context)', () => {
  describe('parseTraceparent()', () => {
    it('parses a valid v00 header into trace-id + parent-id + flags', () => {
      const ctx = parseTraceparent('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01');
      expect(ctx).toEqual({
        version: '00',
        traceId: '0af7651916cd43dd8448eb211c80319c',
        parentId: 'b7ad6b7169203331',
        flags: '01',
        sampled: true,
      });
    });

    it('parses sampled=false when the trace-flag bit is 0', () => {
      const ctx = parseTraceparent('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00');
      expect(ctx?.sampled).toBe(false);
    });

    it('returns null on malformed headers (length / hex)', () => {
      expect(parseTraceparent('')).toBeNull();
      expect(parseTraceparent('00-tooShort-b7ad6b7169203331-01')).toBeNull();
      expect(parseTraceparent('00-not-hex-zzzzzzzzzzzzzzzzzzzzzzzzzzzzz-zzzzzzzzzzzzzzzz-01')).toBeNull();
    });

    it('returns null when trace-id is all zeros (invalid per spec)', () => {
      expect(parseTraceparent('00-00000000000000000000000000000000-b7ad6b7169203331-01')).toBeNull();
    });

    it('returns null when parent-id is all zeros (invalid per spec)', () => {
      expect(parseTraceparent('00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01')).toBeNull();
    });
  });

  describe('runWithRequestContext()', () => {
    it('exposes the context via getRequestContext() within the callback', async () => {
      const result = await runWithRequestContext(
        { requestId: 'req-1', traceId: 't1', parentId: 'p1', sampled: true },
        async () => {
          return getRequestContext();
        },
      );
      expect(result?.requestId).toBe('req-1');
      expect(result?.traceId).toBe('t1');
    });

    it('returns undefined when called outside any context', () => {
      expect(getRequestContext()).toBeUndefined();
    });

    it('isolates concurrent contexts', async () => {
      const a = runWithRequestContext({ requestId: 'A', traceId: 'a', parentId: 'p', sampled: true }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getRequestContext()?.requestId;
      });
      const b = runWithRequestContext({ requestId: 'B', traceId: 'b', parentId: 'p', sampled: true }, async () => {
        await new Promise((r) => setTimeout(r, 1));
        return getRequestContext()?.requestId;
      });
      const [aResult, bResult] = await Promise.all([a, b]);
      expect(aResult).toBe('A');
      expect(bResult).toBe('B');
    });
  });

  describe('RequestContextMiddleware (NestJS)', () => {
    let app: INestApplication;

    beforeAll(async () => {
      @Controller()
      class CtxController {
        @Get('/_ctx')
        ctx(): unknown {
          return getRequestContext() ?? null;
        }
      }

      @Module({
        controllers: [CtxController],
        providers: [RequestContextMiddleware],
      })
      class CtxModule {
        configure(consumer: { apply: (m: typeof RequestContextMiddleware) => { forRoutes: (r: string) => void } }): void {
          consumer.apply(RequestContextMiddleware).forRoutes('*');
        }
      }

      app = await NestFactory.create(CtxModule, { logger: false });
      const middleware = new RequestContextMiddleware();
      app.use(middleware.use.bind(middleware));
      await app.init();
    });

    afterAll(async () => {
      await app?.close();
    });

    it('reuses the trace from a valid traceparent header and reflects it on the response', async () => {
      const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
      const response = await request(app.getHttpServer()).get('/_ctx').set('traceparent', traceparent);
      expect(response.status).toBe(200);
      expect(response.body.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
      expect(response.body.parentId).toBe('b7ad6b7169203331');
      expect(response.body.sampled).toBe(true);
      expect(response.body.requestId).toBeTypeOf('string');
      expect(response.headers['x-request-id']).toBe(response.body.requestId);
      expect(response.headers['traceparent']).toBe(traceparent);
    });

    it('generates a fresh trace when the header is missing or malformed', async () => {
      const response = await request(app.getHttpServer()).get('/_ctx');
      expect(response.status).toBe(200);
      expect(response.body.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(response.body.parentId).toMatch(/^[0-9a-f]{16}$/);
      expect(response.headers['traceparent']).toMatch(
        /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/,
      );
    });
  });
});
