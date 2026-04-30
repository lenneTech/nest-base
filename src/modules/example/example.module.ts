import { Module } from "@nestjs/common";

import { PrismaModule } from "../../core/prisma/prisma.module.js";

import { ExampleController } from "./example.controller.js";
import { ExampleService } from "./example.service.js";

/**
 * ExampleModule — wires the controller and the service.
 *
 * The service depends on `PrismaService` (provided by
 * `PrismaModule`) for all data access. No repository abstraction
 * needed: tests use the `tests/lib/fake-prisma` helper to
 * exercise the service without booting a real Postgres connection.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ExampleController],
  providers: [ExampleService],
  exports: [ExampleService],
})
export class ExampleModule {}
