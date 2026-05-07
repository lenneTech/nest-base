import { Global, Module } from "@nestjs/common";

import { PrismaService } from "./prisma.service.js";

export { EXTRA_AUDITABLE_MODELS } from "./prisma-tokens.js";

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
