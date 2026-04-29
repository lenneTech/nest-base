import { Module } from "@nestjs/common";

import { ExampleController } from "./example.controller.js";
import { EXAMPLE_STORAGE, ExampleService, InMemoryExampleStorage } from "./example.service.js";

/**
 * Example NestJS module — copy this into your project and rename
 * "Example" to whatever the resource is called.
 *
 * To swap the in-memory storage for a real Prisma-backed implementation:
 *
 *   1. Add the model to `prisma/schema.prisma` (or a feature schema)
 *   2. Write `PrismaExampleStorage implements ExampleStorage` in this
 *      folder, injecting `PrismaService` and using
 *      `prisma.runWithRlsTenant(tenantId, () => ...)` for every query
 *   3. Replace `useClass: InMemoryExampleStorage` below with the new
 *      class.
 *
 * The service stays unchanged — only the storage adapter swaps.
 * That's the point of the `EXAMPLE_STORAGE` injection token.
 */
@Module({
  controllers: [ExampleController],
  providers: [ExampleService, { provide: EXAMPLE_STORAGE, useClass: InMemoryExampleStorage }],
  exports: [ExampleService],
})
export class ExampleModule {}
