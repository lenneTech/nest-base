import { type INestApplication, Body, Controller, Module, Post, UsePipes } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import request from "supertest";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ProblemDetailsExceptionFilter } from "../src/core/errors/problem-details.filter.js";
import { ZodValidationPipe } from "../src/core/validation/zod-validation.pipe.js";

const Body$ = z.object({ name: z.string().min(2), age: z.number().int().nonnegative() });

@Controller("echo")
class EchoController {
  @Post()
  @UsePipes(new ZodValidationPipe(Body$))
  echo(@Body() body: z.infer<typeof Body$>): { ok: true; received: typeof body } {
    return { ok: true, received: body };
  }
}

@Module({ controllers: [EchoController] })
class EchoModule {}

/**
 * Adapted from nest-server `map-and-validate.pipe.e2e-spec.ts`.
 *
 * Replaces class-validator with Zod. The pipe
 * runs on every body, query, or param parameter that uses it; failures
 * surface as a 400 + RFC 7807 Problem-Details with field-level errors.
 */
describe("ZodValidationPipe (Map-and-Validate)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(EchoModule, { logger: false });
    app.useGlobalFilters(new ProblemDetailsExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("passes a valid body through to the handler", async () => {
    const response = await request(app.getHttpServer())
      .post("/echo")
      .send({ name: "alice", age: 30 });
    expect(response.status).toBe(201);
    expect(response.body.ok).toBe(true);
  });

  it("rejects an invalid body with 400 + CORE_VALIDATION + per-field errors", async () => {
    const response = await request(app.getHttpServer()).post("/echo").send({ name: "a", age: -1 });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("CORE_VALIDATION");
    expect(response.body.errors).toBeInstanceOf(Array);
    const fields = (response.body.errors as Array<{ path: unknown[] }>).map((e) =>
      e.path.join("."),
    );
    expect(fields).toEqual(expect.arrayContaining(["name", "age"]));
  });

  it("strips unknown properties (Zod default)", async () => {
    const response = await request(app.getHttpServer())
      .post("/echo")
      .send({ name: "alice", age: 30, password: "leak" });
    expect(response.status).toBe(201);
    expect(response.body.received).toEqual({ name: "alice", age: 30 });
  });
});
