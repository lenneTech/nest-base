import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ApiZodBody,
  ApiZodOkResponse,
  ApiZodCreatedResponse,
  ApiZodQuery,
  ApiZodParam,
} from "../../src/core/openapi/zod-api-decorators.js";
import { applyZodSchemaRegistry } from "../../src/core/openapi/zod-openapi-bridge.js";

/**
 * Story · `@ApiZodBody` / `@ApiZodResponse` / `@ApiZodQuery` decorators.
 *
 * These decorators bridge Zod schemas into the `@nestjs/swagger`
 * metadata pipeline. After
 * `SwaggerModule.createDocument(...)` runs, the resulting OpenAPI
 * document MUST contain a non-empty schema for every annotated body,
 * query, parameter, and response.
 *
 * Without this story, kubb generates `body?: never` / `201: unknown`
 * for every Zod-validated route (the friction log).
 */
describe("Story · `@ApiZod*` decorators feed the OpenAPI document", () => {
  const BodySchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().optional(),
  });
  const ResponseSchema = z.object({
    id: z.uuid(),
    name: z.string(),
  });
  const QuerySchema = z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  });

  @Controller("widgets")
  class WidgetController {
    @Post()
    @ApiZodBody(BodySchema)
    @ApiZodCreatedResponse({ schema: ResponseSchema })
    create(@Body() _dto: z.infer<typeof BodySchema>): z.infer<typeof ResponseSchema> {
      return { id: "00000000-0000-0000-0000-000000000000", name: "stub" };
    }

    @Get()
    @ApiZodQuery(QuerySchema)
    @ApiZodOkResponse({ schema: z.array(ResponseSchema) })
    list(@Query() _query: z.infer<typeof QuerySchema>): z.infer<typeof ResponseSchema>[] {
      return [];
    }

    @Get(":id")
    @ApiZodParam("id", z.uuid())
    @ApiZodOkResponse({ schema: ResponseSchema })
    findOne(@Param("id") _id: string): z.infer<typeof ResponseSchema> {
      return { id: "00000000-0000-0000-0000-000000000000", name: "stub" };
    }
  }

  async function buildDocument() {
    const moduleRef = await Test.createTestingModule({
      controllers: [WidgetController],
    }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    const config = new DocumentBuilder().setTitle("test").setVersion("1").build();
    const doc = SwaggerModule.createDocument(app, config);
    applyZodSchemaRegistry(doc);
    await app.close();
    return doc;
  }

  it("populates a non-empty `requestBody.content['application/json'].schema` for `@ApiZodBody`", async () => {
    const doc = await buildDocument();
    const post = doc.paths!["/widgets"]!.post!;
    const schema = post.requestBody!.content!["application/json"]!.schema!;
    // After the bridge runs, the schema MUST have an `object` shape with
    // a `name` property — anything less means the Zod schema didn't
    // reach the document and the SDK will type the body as `never`.
    expect(schema.type).toBe("object");
    expect(schema.properties).toBeDefined();
    expect(schema.properties!.name).toBeDefined();
    expect(schema.required).toEqual(expect.arrayContaining(["name"]));
  });

  it("populates `responses.201.content['application/json'].schema` for `@ApiZodCreatedResponse`", async () => {
    const doc = await buildDocument();
    const post = doc.paths!["/widgets"]!.post!;
    const schema = post.responses!["201"]!.content!["application/json"]!.schema!;
    expect(schema.type).toBe("object");
    expect(schema.properties!.id).toBeDefined();
    expect(schema.properties!.name).toBeDefined();
  });

  it("populates an array `responses.200.content['application/json'].schema` for `@ApiZodOkResponse(z.array(...))`", async () => {
    const doc = await buildDocument();
    const get = doc.paths!["/widgets"]!.get!;
    const schema = get.responses!["200"]!.content!["application/json"]!.schema!;
    expect(schema.type).toBe("array");
    expect(schema.items).toBeDefined();
  });

  it("expands `@ApiZodQuery(z.object({...}))` into individual `parameters` entries", async () => {
    const doc = await buildDocument();
    const get = doc.paths!["/widgets"]!.get!;
    const params = get.parameters!;
    const names = params.map((p: { name: string }) => p.name);
    expect(names).toEqual(expect.arrayContaining(["cursor", "limit"]));
    const limit = params.find((p: { name: string }) => p.name === "limit") as {
      name: string;
      in: string;
      required: boolean;
      schema: { type: string };
    };
    expect(limit).toBeDefined();
    expect(limit.in).toBe("query");
    // `limit` has a default, so the parameter is NOT required — clients
    // may omit it. `cursor` is fully optional.
    expect(limit.required).toBe(false);
    expect(limit.schema.type).toBe("integer");
  });

  it("registers `@ApiZodParam('id', z.uuid())` as a path parameter with the right schema", async () => {
    const doc = await buildDocument();
    const get = doc.paths!["/widgets/{id}"]!.get!;
    const idParam = get.parameters!.find((p: { name: string }) => p.name === "id") as {
      name: string;
      in: string;
      required: boolean;
      schema: { type: string; format?: string };
    };
    expect(idParam).toBeDefined();
    expect(idParam.in).toBe("path");
    expect(idParam.required).toBe(true);
    expect(idParam.schema.type).toBe("string");
    expect(idParam.schema.format).toBe("uuid");
  });

  describe("error paths", () => {
    it("`ApiZodQuery` rejects a non-object schema (would produce un-named parameters)", async () => {
      const { ApiZodQuery: query } = await import("../../src/core/openapi/zod-api-decorators.js");
      // Each top-level property of the object becomes a separate
      // `@ApiQuery` entry; a primitive schema can't be expanded.
      expect(() => query(z.string())).toThrow(/object/i);
    });

    it("`ApiZodResponse` accepts an arbitrary status (e.g. 202)", async () => {
      const { ApiZodResponse: response } =
        await import("../../src/core/openapi/zod-api-decorators.js");
      // The constructor must not throw for non-conventional statuses;
      // the convenience helpers (Ok / Created / NoContent) cover the
      // typical 200/201/204 cases — `ApiZodResponse(202, …)` is the
      // escape hatch.
      expect(() => response(202, { schema: z.object({ id: z.uuid() }) })).not.toThrow();
    });
  });
});
