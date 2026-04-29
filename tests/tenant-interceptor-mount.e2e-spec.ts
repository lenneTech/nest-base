import { Controller, Get } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  TenantInterceptor,
  getCurrentTenantId,
} from "../src/core/multi-tenancy/tenant.interceptor.js";

@Controller("test-tenant")
class TestController {
  @Get("current")
  current(): { tenantId: string | undefined } {
    return { tenantId: getCurrentTenantId() };
  }

  @Get("exempt")
  exempt(): { ok: true } {
    return { ok: true };
  }
}

@Controller()
class RootController {
  @Get()
  root(): { tenantId: string | undefined } {
    return { tenantId: getCurrentTenantId() };
  }
}

/**
 * `TenantInterceptor` registered as `APP_INTERCEPTOR` populates the
 * AsyncLocalStorage tenant context for every non-exempt route.
 * Domain code reads it via `getCurrentTenantId()`.
 */
describe("TenantInterceptor · global registration", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let nestApp: any;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TestController, RootController],
      providers: [{ provide: APP_INTERCEPTOR, useClass: TenantInterceptor }],
    }).compile();
    nestApp = moduleRef.createNestApplication({ logger: false });
    await nestApp.init();
  });

  afterAll(async () => {
    await nestApp.close();
  });

  const TENANT = "11111111-1111-1111-1111-111111111111";

  it("attaches the tenant id from x-tenant-id header for non-exempt routes", async () => {
    const res = await request(nestApp.getHttpServer())
      .get("/test-tenant/current")
      .set("x-tenant-id", TENANT);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tenantId: TENANT });
  });

  it("rejects requests without the tenant header on non-exempt routes", async () => {
    const res = await request(nestApp.getHttpServer()).get("/test-tenant/current");
    // The interceptor throws TenantIsolationError → NestJS exception filter
    // turns it into a 500 (no specific mapping). What matters: NOT 200.
    expect(res.status).not.toBe(200);
  });

  it("exempts the root path / (no tenant header required)", async () => {
    const res = await request(nestApp.getHttpServer()).get("/");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tenantId: undefined });
  });

  it("rejects malformed tenant headers (not a UUID)", async () => {
    const res = await request(nestApp.getHttpServer())
      .get("/test-tenant/current")
      .set("x-tenant-id", "not-a-uuid");
    expect(res.status).not.toBe(200);
  });
});
