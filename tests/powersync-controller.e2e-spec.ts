import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
const TENANT = "11111111-1111-1111-1111-111111111111";

describe("PowerSyncController · POST /powersync/crud", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
  });

  afterAll(async () => {
    await app.close();
  });

  it("accepts a valid batch and returns 204", async () => {
    const res = await request(app.getHttpServer())
      .post("/powersync/crud")
      .set("x-tenant-id", TENANT)
      .send({
        batch: [{ op: "PUT", type: "widgets", id: "w1", data: { name: "foo" } }],
      });
    expect(res.status).toBe(204);
  });

  it("400s on a malformed batch (unknown op)", async () => {
    const res = await request(app.getHttpServer())
      .post("/powersync/crud")
      .set("x-tenant-id", TENANT)
      .send({ batch: [{ op: "NUKE", type: "x", id: "y", data: {} }] });
    expect(res.status).toBe(400);
  });

  it("400s on missing batch field", async () => {
    const res = await request(app.getHttpServer())
      .post("/powersync/crud")
      .set("x-tenant-id", TENANT)
      .send({});
    expect(res.status).toBe(400);
  });
});
