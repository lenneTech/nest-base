import { Controller, Get, Injectable, type NestMiddleware } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { NextFunction, Request, Response } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  TenantInterceptor,
  getCurrentTenantId,
} from "../src/core/multi-tenancy/tenant.interceptor.js";
import { PrismaService } from "../src/core/prisma/prisma.service.js";

/** Test-only: inject `req.user.activeOrganizationId` from a header. */
@Injectable()
class TestSessionMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const org = req.headers["x-test-active-org"];
    if (typeof org === "string" && org.length > 0) {
      (req as Request & { user?: { id: string; activeOrganizationId: string } }).user = {
        id: "test-user",
        activeOrganizationId: org,
      };
    }
    next();
  }
}

@Controller("admin/test-tenant")
class TestController {
  @Get("current")
  current(): { tenantId: string | undefined } {
    return { tenantId: getCurrentTenantId() };
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
 * AsyncLocalStorage tenant context from session.activeOrganizationId.
 */
describe("TenantInterceptor · global registration", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let nestApp: any;

  const TENANT = "11111111-1111-1111-1111-111111111111";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TestController, RootController],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
        { provide: PrismaService, useValue: { member: { findFirst: async () => null } } },
        TestSessionMiddleware,
      ],
    }).compile();
    nestApp = moduleRef.createNestApplication({ logger: false });
    nestApp.use((req: Request, res: Response, next: NextFunction) =>
      new TestSessionMiddleware().use(req, res, next),
    );
    await nestApp.init();
  });

  afterAll(async () => {
    await nestApp.close();
  });

  it("attaches the tenant id from session activeOrganizationId", async () => {
    const res = await request(nestApp.getHttpServer())
      .get("/admin/test-tenant/current")
      .set("x-test-active-org", TENANT);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tenantId: TENANT });
  });

  it("ignores stray x-tenant-id when session org is set", async () => {
    const other = "22222222-2222-2222-2222-222222222222";
    const res = await request(nestApp.getHttpServer())
      .get("/admin/test-tenant/current")
      .set("x-test-active-org", TENANT)
      .set("x-tenant-id", other);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tenantId: TENANT });
  });

  it("rejects unauthenticated requests on non-exempt routes", async () => {
    const res = await request(nestApp.getHttpServer()).get("/admin/test-tenant/current");
    expect(res.status).not.toBe(200);
  });

  it("exempts the root path / (no tenant required)", async () => {
    const res = await request(nestApp.getHttpServer()).get("/");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tenantId: undefined });
  });

  it("rejects authenticated requests without activeOrganizationId", async () => {
    const res = await request(nestApp.getHttpServer())
      .get("/admin/test-tenant/current")
      .set("x-tenant-id", TENANT);
    expect(res.status).not.toBe(200);
  });
});
