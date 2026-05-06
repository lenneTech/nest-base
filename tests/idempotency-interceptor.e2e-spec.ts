import { Body, Controller, type INestApplication, Post } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Public } from "../src/core/permissions/public.decorator.js";

/**
 * E2E · Idempotency-Key interceptor end-to-end (CF.STORAGE.01 — iter-180).
 *
 * Iter-179 added the Prisma-backed adapter for the idempotency store.
 * iter-180 pins the full HTTP-layer contract: the interceptor at
 * `src/core/idempotency/idempotency.module.ts` catches the
 * `Idempotency-Key` header on POST/PATCH/PUT/DELETE, hashes the
 * request fingerprint, persists the cached response, and replays
 * subsequent matching requests with `idempotency-replay: 1` instead
 * of re-invoking the handler.
 *
 * The probe controller below counts handler invocations so the test
 * can distinguish "served from cache" (count unchanged) from "handler
 * re-ran" (count incremented). The test boots AppModule under
 * `Test.createTestingModule(...)` and goes through supertest — the
 * full DI chain runs, including the Prisma-backed store binding when
 * the global Postgres testcontainer carries the `idempotency_records`
 * table.
 */

let invocations = 0;

@Controller("hub/idempotency-probe")
class IdempotencyProbeController {
  @Post()
  @Public("test-only idempotency probe — exercises the interceptor")
  create(@Body() body: { value?: string; nested?: Record<string, unknown> }): {
    invocation: number;
    echo: { value?: string; nested?: Record<string, unknown> };
  } {
    invocations += 1;
    return { invocation: invocations, echo: body };
  }
}

describe("E2E · Idempotency-Key interceptor through HTTP layer", () => {
  let app: INestApplication;
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  const originalBaseUrl = process.env.APP_BASE_URL;

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET = "test-secret-32-chars-minimum-aaaaaaaa";
    process.env.APP_BASE_URL = "http://localhost:3000";
    const { AppModule } = await import("../src/core/app/app.module.js");
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [IdempotencyProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    // Mirror bootstrap.ts so routes register under /api/hub/... —
    // the probe controller is @Controller("hub/...").
    app.setGlobalPrefix("api", {
      exclude: ["/", "hub/login", "hub/logout", "health", "health/(.*)"],
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

  it("first POST with Idempotency-Key runs the handler (no replay header)", async () => {
    invocations = 0;
    const key = `e2e-${crypto.randomUUID()}`;
    const res = await request(app.getHttpServer())
      .post("/api/hub/idempotency-probe")
      .set("Idempotency-Key", key)
      .set("Content-Type", "application/json")
      .send({ value: "first" });
    expect(res.status).toBe(201);
    expect(res.body.invocation).toBe(1);
    expect(res.body.echo).toEqual({ value: "first" });
    expect(res.headers["idempotency-replay"]).toBeUndefined();
    expect(invocations).toBe(1);
  });

  it("second POST with same key + same body returns the cached response and sets idempotency-replay: 1", async () => {
    invocations = 0;
    const key = `e2e-${crypto.randomUUID()}`;
    const body = { value: "replayable", nested: { x: 1, y: ["a", "b"] } };

    const first = await request(app.getHttpServer())
      .post("/api/hub/idempotency-probe")
      .set("Idempotency-Key", key)
      .set("Content-Type", "application/json")
      .send(body);
    expect(first.status).toBe(201);
    expect(first.body.invocation).toBe(1);
    expect(invocations).toBe(1);

    const second = await request(app.getHttpServer())
      .post("/api/hub/idempotency-probe")
      .set("Idempotency-Key", key)
      .set("Content-Type", "application/json")
      .send(body);
    expect(second.status).toBe(201);
    // The handler is NOT re-invoked — invocation count stays at 1
    // and the body matches the first response byte-for-byte.
    expect(invocations).toBe(1);
    expect(second.body.invocation).toBe(1);
    expect(second.body.echo).toEqual(body);
    expect(second.headers["idempotency-replay"]).toBe("1");
  });

  it("same key with a different body raises a 409-class error and does NOT re-invoke the handler", async () => {
    invocations = 0;
    const key = `e2e-${crypto.randomUUID()}`;

    const first = await request(app.getHttpServer())
      .post("/api/hub/idempotency-probe")
      .set("Idempotency-Key", key)
      .set("Content-Type", "application/json")
      .send({ value: "original" });
    expect(first.status).toBe(201);
    expect(invocations).toBe(1);

    const conflict = await request(app.getHttpServer())
      .post("/api/hub/idempotency-probe")
      .set("Idempotency-Key", key)
      .set("Content-Type", "application/json")
      .send({ value: "different" });
    // Stripe-style 409: the SECOND request did NOT run the handler,
    // so user data isn't written under a colliding key, and the
    // response is an RFC 7807 problem-details body with
    // CORE_CONFLICT + the offending key for debugability.
    expect(conflict.status).toBe(409);
    expect(conflict.headers["content-type"]).toContain("application/problem+json");
    expect(conflict.body.code).toBe("CORE_CONFLICT");
    expect(conflict.body.title).toBe("Idempotency-Key Conflict");
    expect(conflict.body.idempotencyKey).toBe(key);
    expect(invocations).toBe(1);
  });

  it("requests without Idempotency-Key bypass the interceptor (every call runs the handler)", async () => {
    invocations = 0;
    const a = await request(app.getHttpServer())
      .post("/api/hub/idempotency-probe")
      .set("Content-Type", "application/json")
      .send({ value: "no-key-1" });
    const b = await request(app.getHttpServer())
      .post("/api/hub/idempotency-probe")
      .set("Content-Type", "application/json")
      .send({ value: "no-key-2" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(invocations).toBe(2);
    expect(a.body.invocation).toBe(1);
    expect(b.body.invocation).toBe(2);
  });

  it("two distinct keys do not share cache state — each runs the handler exactly once", async () => {
    invocations = 0;
    const k1 = `e2e-${crypto.randomUUID()}`;
    const k2 = `e2e-${crypto.randomUUID()}`;
    const body = { value: "shared-body" };

    const r1 = await request(app.getHttpServer())
      .post("/api/hub/idempotency-probe")
      .set("Idempotency-Key", k1)
      .set("Content-Type", "application/json")
      .send(body);
    const r2 = await request(app.getHttpServer())
      .post("/api/hub/idempotency-probe")
      .set("Idempotency-Key", k2)
      .set("Content-Type", "application/json")
      .send(body);

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(invocations).toBe(2);
    expect(r1.body.invocation).toBe(1);
    expect(r2.body.invocation).toBe(2);
    expect(r1.headers["idempotency-replay"]).toBeUndefined();
    expect(r2.headers["idempotency-replay"]).toBeUndefined();
  });
});
