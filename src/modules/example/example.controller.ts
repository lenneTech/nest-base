/**
 * Example controller — reference for tenant-scoped REST endpoints.
 *
 * Patterns demonstrated:
 *   - Per-handler ZodValidationPipe wiring through @Body/@Query
 *   - Tenant id pulled from the AsyncLocalStorage (request-scoped),
 *     not from path/body — RLS won't trust client-supplied tenants
 *   - Idiomatic NestJS-style status codes (201 on POST, 204 on DELETE)
 *
 * Permission gates (`@Can('action', 'Subject')`) are commented in
 * because the example resource is not registered with CASL yet.
 * Uncomment + register the subject in the permission catalog once
 * you've adapted the module for your real resource.
 */

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";

// import { Can } from "../../core/permissions/can.guard.js";
import { getCurrentTenantId } from "../../core/multi-tenancy/tenant.interceptor.js";
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

  @Post()
  @HttpCode(201)
  // @Can("create", "Example")
  async create(
    @Body(new ZodValidationPipe(CreateExampleSchema)) dto: CreateExampleDto,
  ): Promise<ExampleResponse> {
    return this.service.create(requireTenant(), dto);
  }

  @Get()
  // @Can("read", "Example")
  async list(@Query(new ZodValidationPipe(ListExampleQuerySchema)) query: ListExampleQuery) {
    return this.service.list(requireTenant(), query);
  }

  @Get(":id")
  // @Can("read", "Example")
  async findOne(@Param("id") id: string): Promise<ExampleResponse> {
    return this.service.findById(requireTenant(), id);
  }

  @Patch(":id")
  // @Can("update", "Example")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateExampleSchema)) dto: UpdateExampleDto,
  ): Promise<ExampleResponse> {
    return this.service.update(requireTenant(), id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  // @Can("delete", "Example")
  async remove(@Param("id") id: string): Promise<void> {
    await this.service.remove(requireTenant(), id);
  }
}

/**
 * Pulls the tenant id off the AsyncLocalStorage that
 * `TenantInterceptor` populates on every non-exempt request. If you
 * see this throw at runtime, the route is hitting a non-tenant-aware
 * code path — usually because the path is in `EXEMPT_PREFIXES`.
 */
function requireTenant(): string {
  const tenantId = getCurrentTenantId();
  if (!tenantId) {
    throw new Error("example: no tenant id in request context (route is exempt?)");
  }
  return tenantId;
}
