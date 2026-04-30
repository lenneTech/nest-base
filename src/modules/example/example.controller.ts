/**
 * Example controller — REST endpoints. Thin by design: the controller
 * is a transport adapter that:
 *   1. validates the request body / query (via the Zod pipe)
 *   2. picks the active tenant out of the AsyncLocalStorage (set
 *      by `TenantInterceptor` from the `x-tenant-id` header)
 *   3. delegates to `ExampleService`
 *   4. returns the response shape to NestJS
 *
 * What it does NOT do:
 *   - mutate records directly (that's the service)
 *   - look at the database (that's the repository)
 *   - format errors (the global RFC 7807 filter does that)
 *
 * The `@Can()` decorators are deliberately wired here so an auditor
 * scanning `/dev/routes` sees every endpoint guarded by the same
 * mechanism the rest of the codebase uses.
 */

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";

import { Can } from "../../core/permissions/can.guard.js";
import { ZodValidationPipe } from "../../core/validation/zod-validation.pipe.js";

import {
  type CreateExampleDto,
  CreateExampleSchema,
  type ExampleResponse,
  type ListExampleQuery,
  ListExampleQuerySchema,
  type UpdateExampleDto,
  UpdateExampleSchema,
} from "./example.dto.js";
import { ExampleService } from "./example.service.js";
import { requireTenant } from "./require-tenant.js";

@Controller("examples")
export class ExampleController {
  constructor(private readonly service: ExampleService) {}

  @Can("create", "Example")
  @Post()
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(CreateExampleSchema)) dto: CreateExampleDto,
  ): Promise<ExampleResponse> {
    return this.service.create(requireTenant(), dto);
  }

  @Can("read", "Example")
  @Get()
  async list(@Query(new ZodValidationPipe(ListExampleQuerySchema)) query: ListExampleQuery) {
    return this.service.list(requireTenant(), query);
  }

  @Can("read", "Example")
  @Get(":id")
  async findOne(@Param("id") id: string): Promise<ExampleResponse> {
    return this.service.findById(requireTenant(), id);
  }

  @Can("update", "Example")
  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateExampleSchema)) dto: UpdateExampleDto,
  ): Promise<ExampleResponse> {
    return this.service.update(requireTenant(), id, dto);
  }

  @Can("delete", "Example")
  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id") id: string): Promise<void> {
    await this.service.remove(requireTenant(), id);
  }
}
