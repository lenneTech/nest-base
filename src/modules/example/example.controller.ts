/**
 * Example controller — REST endpoints for the example resource.
 *
 * Thin transport layer: validates the body / query (Zod pipe), pulls
 * the active tenant from the AsyncLocalStorage that
 * `TenantInterceptor` populates on every non-exempt request, and
 * delegates to `ExampleService`. Errors flow through the global
 * RFC 7807 filter.
 */

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";

import { getCurrentTenantId } from "../../core/multi-tenancy/tenant.interceptor.js";
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

function requireTenant(): string {
  const tenantId = getCurrentTenantId();
  if (!tenantId) {
    throw new Error("example: no tenant id in request context (route is exempt?)");
  }
  return tenantId;
}
