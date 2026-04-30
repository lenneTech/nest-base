import {
  type INestApplication,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Module,
  NotFoundException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import request from "supertest";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ProblemDetailsExceptionFilter } from "../src/core/errors/problem-details.filter.js";
import { TenantIsolationError } from "../src/core/multi-tenancy/tenant-header.js";

const Body = z.object({ name: z.string().min(2) });

@Controller("boom")
class BoomController {
  @Get("not-found")
  notFound(): void {
    throw new NotFoundException("No user with id=42");
  }

  @Get("forbidden")
  forbidden(): void {
    throw new HttpException("locked down", HttpStatus.FORBIDDEN);
  }

  @Get("zod")
  zod(): void {
    Body.parse({ name: "a" });
  }

  @Get("boom")
  boom(): void {
    throw new Error("kaboom");
  }

  @Get("ok")
  ok(): { ok: true } {
    return { ok: true };
  }

  @Get("bad-request")
  badRequest(): void {
    throw new HttpException("bad input", HttpStatus.BAD_REQUEST);
  }

  @Get("unauthorized")
  unauthorized(): void {
    throw new HttpException("no token", HttpStatus.UNAUTHORIZED);
  }

  @Get("conflict")
  conflict(): void {
    throw new HttpException("exists already", HttpStatus.CONFLICT);
  }

  @Get("rate-limited")
  rateLimited(): void {
    throw new HttpException("too many", HttpStatus.TOO_MANY_REQUESTS);
  }

  @Get("teapot")
  teapot(): void {
    throw new HttpException("I am a teapot", HttpStatus.I_AM_A_TEAPOT);
  }

  @Get("http-string")
  httpString(): void {
    throw new HttpException("plain string", HttpStatus.BAD_REQUEST);
  }

  @Get("http-array")
  httpArray(): void {
    throw new HttpException({ message: ["one", "two"] }, HttpStatus.BAD_REQUEST);
  }

  @Get("bad-gateway")
  badGateway(): void {
    throw new HttpException("upstream sad", HttpStatus.BAD_GATEWAY);
  }

  @Get("tenant-missing")
  tenantMissing(): void {
    throw new TenantIsolationError("tenant header is required");
  }
}

@Module({ controllers: [BoomController] })
class BoomModule {}

/**
 * Adapted from nest-server `error-code-scenarios.e2e-spec.ts`.
 *
 * Every error response on the API must follow RFC 7807 Problem Details
 * with our `CORE_*` codes. The filter recognizes:
 *   - `HttpException` (NestJS) → reuse status + `CORE_*` mapping
 *   - `ZodError` → 400 + `CORE_VALIDATION` + per-field `errors`
 *   - anything else → 500 + `CORE_INTERNAL`, message redacted
 *
 * Successful responses pass through untouched.
 */
describe("Problem-Details exception filter", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(BoomModule, { logger: false });
    app.useGlobalFilters(new ProblemDetailsExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("NotFoundException becomes 404 + CORE_NOT_FOUND", async () => {
    const response = await request(app.getHttpServer()).get("/boom/not-found");
    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(response.body).toMatchObject({
      type: expect.stringContaining("CORE_NOT_FOUND"),
      title: expect.any(String),
      status: 404,
      code: "CORE_NOT_FOUND",
      detail: "No user with id=42",
      instance: "/boom/not-found",
    });
  });

  it("HttpException(403) becomes 403 + CORE_FORBIDDEN", async () => {
    const response = await request(app.getHttpServer()).get("/boom/forbidden");
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("CORE_FORBIDDEN");
    expect(response.body.status).toBe(403);
  });

  it("ZodError becomes 400 + CORE_VALIDATION with per-field errors", async () => {
    const response = await request(app.getHttpServer()).get("/boom/zod");
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("CORE_VALIDATION");
    expect(response.body.errors).toBeInstanceOf(Array);
    expect(response.body.errors.length).toBeGreaterThan(0);
    expect(response.body.errors[0]).toMatchObject({
      path: expect.any(Array),
      message: expect.any(String),
    });
  });

  it("Unknown Error becomes 500 + CORE_INTERNAL with redacted detail", async () => {
    const response = await request(app.getHttpServer()).get("/boom/boom");
    expect(response.status).toBe(500);
    expect(response.body.code).toBe("CORE_INTERNAL");
    expect(response.body.detail).not.toContain("kaboom");
  });

  it("TenantIsolationError becomes 400 + CORE_VALIDATION (not 500)", async () => {
    const response = await request(app.getHttpServer()).get("/boom/tenant-missing");
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: "CORE_VALIDATION",
      title: "Tenant Header Required",
      detail: "tenant header is required",
      status: 400,
    });
  });

  it("Successful responses are not touched", async () => {
    const response = await request(app.getHttpServer()).get("/boom/ok");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it.each([
    ["/boom/bad-request", 400, "CORE_VALIDATION", "Bad Request"],
    ["/boom/unauthorized", 401, "CORE_UNAUTHORIZED", "Unauthorized"],
    ["/boom/conflict", 409, "CORE_CONFLICT", "Conflict"],
    ["/boom/rate-limited", 429, "CORE_RATE_LIMITED", "Too Many Requests"],
    ["/boom/bad-gateway", 502, "CORE_INTERNAL", "Internal Server Error"],
    ["/boom/teapot", 418, "CORE_VALIDATION", "Error"],
  ])("maps HTTP %s to %s/%s/%s", async (path, status, code, title) => {
    const response = await request(app.getHttpServer()).get(path);
    expect(response.status).toBe(status);
    expect(response.body.code).toBe(code);
    expect(response.body.title).toBe(title);
  });

  it("uses the HttpException string body as the detail", async () => {
    const response = await request(app.getHttpServer()).get("/boom/http-string");
    expect(response.body.detail).toBe("plain string");
  });

  it("joins HttpException array messages with commas", async () => {
    const response = await request(app.getHttpServer()).get("/boom/http-array");
    expect(response.body.detail).toBe("one, two");
  });
});
