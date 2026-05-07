import { Controller, Get, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { Public } from "../src/core/permissions/public.decorator.js";

/**
 * E2E · `Test.createTestingModule({ imports: [AppModule] })` inherits
 * the global `ProblemDetailsExceptionFilter`.
 *
 * Friction log 2026-05-03 entry "Test.createTestingModule()
 * createNestApplication does not register ProblemDetailsExceptionFilter":
 * the filter used to be attached only by `bootstrap()` via
 * `app.useGlobalFilters(...)`. Tests that boot through
 * `Test.createTestingModule({ imports: [AppModule] }).createNestApplication()`
 * skip `bootstrap()` and therefore lacked the filter — a `ZodError`
 * raised inside a handler returned 500 instead of 400 + CORE_VALIDATION,
 * silently inverting the ZodValidationPipe's documented contract.
 *
 * Fix: register the filter as `{ provide: APP_FILTER, useClass:
 * ProblemDetailsExceptionFilter }` inside `AppModule`. Production AND
 * test boots both inherit it through DI for free; no per-spec
 * `useGlobalFilters(...)` boilerplate.
 *
 * This e2e pins the contract: import `AppModule` AS-IS via the testing
 * module, throw a `ZodError` from a sibling probe controller, and
 * assert the response is 400 + `application/problem+json` + body
 * `code: "CORE_VALIDATION"`. Was RED before the AppModule edit, GREEN
 * after.
 */

const Body = z.object({ name: z.string().min(2) });

// `/hub/*` is on the path-allowlist (jwt-middleware `PUBLIC_PREFIXES`
// + tenant-guard `EXEMPT_*`) so neither the session middleware nor
// the tenant guard can short-circuit our request to 401/403 before
// the handler runs. That keeps this test's assertion narrowly focused
// on the global exception filter (ZodError → 400 + CORE_VALIDATION),
// not on the auth chain.
@Controller("hub/filter-inheritance-probe")
class ZodBoomController {
  @Get("zod")
  @Public("test-only ZodError probe — exercises global ProblemDetailsExceptionFilter")
  zod(): void {
    // The validation literally fails — the filter must catch the
    // ZodError. If the filter is missing, NestJS' default exception
    // handler emits a 500.
    Body.parse({ name: "a" });
  }
}

describe("E2E · APP_FILTER inheritance via Test.createTestingModule({ imports: [AppModule] })", () => {
  let app: INestApplication;
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  const originalBaseUrl = process.env.APP_BASE_URL;

  beforeAll(async () => {
    // Better-Auth boots eagerly when AppModule loads — give it the
    // bare-minimum env so its config validation passes.
    process.env.BETTER_AUTH_SECRET = "test-secret-32-chars-minimum-aaaaaaaa";
    process.env.APP_BASE_URL = "http://localhost:3000";
    const { AppModule } = await import("../src/core/app/app.module.js");
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ZodBoomController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    // Mirror bootstrap.ts: set the global /api/ prefix so the probe
    // controller at @Controller("hub/...") registers under /hub/...
    app.setGlobalPrefix("api", {
      exclude: [
        "hub",
        "hub/(.*)",
        "admin",
        "admin/(.*)",
        "errors",
        "errors/(.*)",
        "openapi",
        "hub/login",
        "hub/logout",
        "health",
        "health/(.*)",
      ],
    });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = originalSecret;
    if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBaseUrl;
  });

  it("returns 400 + CORE_VALIDATION + problem+json content-type for an in-handler ZodError", async () => {
    const res = await request(app.getHttpServer()).get("/hub/filter-inheritance-probe/zod");
    // Was 500 + plain JSON before the AppModule APP_FILTER edit.
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({
      code: "CORE_VALIDATION",
      status: 400,
    });
    // The filter also synthesises the per-field `errors` array from
    // `ZodError.issues` — pin a thin invariant so future filter
    // refactors that drop this attribute fail this spec loudly.
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });
});
