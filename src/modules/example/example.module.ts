import { Module } from "@nestjs/common";

import { PrismaModule } from "../../core/prisma/prisma.module.js";

import { ExampleController } from "./example.controller.js";
import { InMemoryExampleRepository } from "./example.repository.in-memory.js";
import { PrismaExampleRepository } from "./example.repository.prisma.js";
import { ExampleService } from "./example.service.js";
import { EXAMPLE_REPOSITORY } from "./example.tokens.js";

/**
 * ExampleModule — wires the controller, the service, and the active
 * repository binding.
 *
 * Two repository implementations ship in this module:
 *   - `PrismaExampleRepository` — real Postgres access. Default
 *     binding because that's the production case. Requires the
 *     `examples` table to exist (`bun run prisma:migrate`).
 *   - `InMemoryExampleRepository` — fast process-local storage,
 *     used by unit / story tests via direct instantiation. Also
 *     useful if you want the module to boot before migrations have
 *     been applied — flip the `useClass` below to switch.
 *
 * The service depends on the `ExampleRepository` interface only,
 * never on either implementation. Swapping is a one-line change.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ExampleController],
  providers: [
    ExampleService,
    InMemoryExampleRepository,
    PrismaExampleRepository,
    { provide: EXAMPLE_REPOSITORY, useClass: PrismaExampleRepository },
  ],
  exports: [ExampleService],
})
export class ExampleModule {}
