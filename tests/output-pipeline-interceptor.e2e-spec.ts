import { Controller, Get } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OutputPipelineInterceptor } from "../src/core/output-pipeline/output-pipeline.interceptor.js";

@Controller("test-pipeline")
class TestController {
  @Get("returns-secret")
  returnsSecret(): { name: string; password: string } {
    return { name: "visible", password: "should-be-stripped" };
  }

  @Get("returns-array")
  returnsArray(): Array<{ id: string; token: string }> {
    return [
      { id: "1", token: "leak-1" },
      { id: "2", token: "leak-2" },
    ];
  }

  @Get("returns-nested")
  returnsNested(): { user: { id: string; passwordHash: string } } {
    return { user: { id: "1", passwordHash: "$argon2id$leak" } };
  }

  @Get("returns-null")
  returnsNull(): null {
    return null;
  }
}

/**
 * `OutputPipelineInterceptor` is registered as a global NestJS
 * interceptor and runs the safety-net + secret-strip stages of the
 * output pipeline on every controller response. (Field-allowlist
 * + permission filtering kick in once an Ability is resolvable per
 * request — that lands when auth is wired.)
 */
describe("OutputPipelineInterceptor · global registration", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let nestApp: any;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TestController],
      providers: [{ provide: APP_INTERCEPTOR, useClass: OutputPipelineInterceptor }],
    }).compile();
    nestApp = moduleRef.createNestApplication({ logger: false });
    await nestApp.init();
  });

  afterAll(async () => {
    await nestApp.close();
  });

  it("strips secret-named fields from response objects", async () => {
    const res = await request(nestApp.getHttpServer()).get("/test-pipeline/returns-secret");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: "visible" });
    expect(res.body).not.toHaveProperty("password");
  });

  it("strips secret-named fields from arrays of objects", async () => {
    const res = await request(nestApp.getHttpServer()).get("/test-pipeline/returns-array");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: "1" }, { id: "2" }]);
  });

  it("strips secret-named fields recursively from nested objects", async () => {
    const res = await request(nestApp.getHttpServer()).get("/test-pipeline/returns-nested");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: { id: "1" } });
    expect(res.body.user).not.toHaveProperty("passwordHash");
  });

  it("passes through null without crashing", async () => {
    const res = await request(nestApp.getHttpServer()).get("/test-pipeline/returns-null");
    expect(res.status).toBe(200);
    // Express serialises a controller `null` return as ""
    expect(res.body).toEqual({});
  });
});
