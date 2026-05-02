import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * `/api/openapi.json` MUST expose typed bodies + responses for every
 * Zod-validated route — otherwise the kubb-generated SDK types each
 * route as `body?: never` / `200: unknown`, and the frontend's
 * "Backend Types: Generated only" rule becomes unenforceable.
 *
 * This spec asserts that the slim-module reference (`/v1/examples`)
 * surfaces a typed `requestBody.schema` for the POST handler and a
 * typed response schema for the GET-by-id handler, both produced by
 * the new `@ApiZod*` decorators.
 *
 * Friction log: "Generated `types.gen.ts` has the URL paths but every
 * body / response slot is `never` or `unknown`."
 */
describe("OpenAPI Zod bridge — `/api/openapi.json` carries Zod-derived schemas", () => {
  let app: INestApplication;
  let document: {
    paths: Record<string, Record<string, unknown>>;
    components?: { schemas?: Record<string, unknown> };
  };

  beforeAll(async () => {
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    const res = await request(app.getHttpServer()).get("/api/openapi.json");
    expect(res.status).toBe(200);
    document = res.body;
  });

  afterAll(async () => {
    await app?.close();
  });

  function pathOp(path: string, method: string): {
    requestBody?: {
      content: Record<
        string,
        {
          schema: {
            type?: string;
            properties?: Record<string, { type?: string }>;
            required?: string[];
            $ref?: string;
          };
        }
      >;
    };
    responses?: Record<
      string,
      {
        content?: Record<
          string,
          {
            schema: {
              type?: string;
              properties?: Record<string, { type?: string }>;
              $ref?: string;
            };
          }
        >;
      }
    >;
    parameters?: Array<{
      name: string;
      in: string;
      required?: boolean;
      schema?: { type?: string; format?: string };
    }>;
  } {
    const ops = document.paths[path];
    if (!ops) {
      throw new Error(`OpenAPI doc missing path ${path}`);
    }
    const op = ops[method];
    if (!op) {
      throw new Error(`OpenAPI doc missing ${method.toUpperCase()} ${path}`);
    }
    return op as ReturnType<typeof pathOp>;
  }

  it("POST /examples carries a typed request body schema (not `never`)", () => {
    const op = pathOp("/examples", "post");
    const schema = op.requestBody?.content["application/json"]?.schema;
    expect(schema).toBeDefined();
    if (schema?.$ref) {
      // If the bridge $ref's a named schema, the named schema must
      // resolve under components.
      const refName = schema.$ref.replace("#/components/schemas/", "");
      expect(document.components?.schemas?.[refName]).toBeDefined();
    } else {
      expect(schema!.type).toBe("object");
      expect(schema!.properties).toBeDefined();
      expect(schema!.properties!.name).toBeDefined();
      expect(schema!.required).toEqual(expect.arrayContaining(["name"]));
    }
  });

  it("POST /examples carries a typed 201 response schema (not `unknown`)", () => {
    const op = pathOp("/examples", "post");
    const schema = op.responses?.["201"]?.content?.["application/json"]?.schema;
    expect(schema).toBeDefined();
    if (schema?.$ref) {
      const refName = schema.$ref.replace("#/components/schemas/", "");
      expect(document.components?.schemas?.[refName]).toBeDefined();
    } else {
      expect(schema!.type).toBe("object");
      expect(schema!.properties!.id).toBeDefined();
      expect(schema!.properties!.name).toBeDefined();
    }
  });

  it("GET /examples carries query parameters derived from the Zod schema", () => {
    const op = pathOp("/examples", "get");
    const params = op.parameters ?? [];
    const names = params.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["cursor", "limit"]));
  });

  it("GET /examples/{id} carries a typed 200 response schema", () => {
    const op = pathOp("/examples/{id}", "get");
    const schema = op.responses?.["200"]?.content?.["application/json"]?.schema;
    expect(schema).toBeDefined();
    if (schema?.$ref) {
      const refName = schema.$ref.replace("#/components/schemas/", "");
      expect(document.components?.schemas?.[refName]).toBeDefined();
    } else {
      expect(schema!.type).toBe("object");
      expect(schema!.properties!.id).toBeDefined();
    }
  });
});
