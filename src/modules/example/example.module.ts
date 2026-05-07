import { Module } from "@nestjs/common";

import { EXTRA_AUDITABLE_MODELS } from "../../core/prisma/prisma-tokens.js";
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
 *
 * `EXTRA_AUDITABLE_MODELS` registers "Example" into the audit
 * extension's opt-in list. Project modules that own domain models
 * which need audit tracking use the same pattern — no edits to
 * `src/core/prisma/prisma.service.ts` required.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ExampleController],
  providers: [
    ExampleService,
    // Register the Example model for audit tracking. The
    // EXTRA_AUDITABLE_MODELS token is read by PrismaService and
    // merged with the core defaults (Organization, Member, Role, …).
    { provide: EXTRA_AUDITABLE_MODELS, useValue: ["Example"] },
  ],
  exports: [ExampleService],
})
export class ExampleModule {}
