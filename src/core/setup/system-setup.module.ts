import {
  Inject,
  Injectable,
  type LoggerService,
  Logger,
  Module,
  type OnModuleInit,
} from "@nestjs/common";

import { PrismaModule } from "../prisma/prisma.module.js";

import { PrismaAdminProvisioningStorage } from "./admin-storage.prisma.js";
import {
  type AdminProvisioningStorage,
  type ProvisionResult,
  SystemSetupService,
} from "./system-setup.service.js";
import { systemSetupConfigFromEnv } from "./system-setup-config.js";

const ADMIN_PROVISIONING_STORAGE = Symbol.for("lt:AdminProvisioningStorage");

@Injectable()
class SystemSetupBootstrap implements OnModuleInit {
  private readonly logger: LoggerService = new Logger("SystemSetup");
  private lastResult: ProvisionResult | null = null;

  constructor(
    @Inject(ADMIN_PROVISIONING_STORAGE) storage: AdminProvisioningStorage,
    @Inject(SystemSetupService)
    private readonly service: SystemSetupService = new SystemSetupService(storage),
  ) {}

  async onModuleInit(): Promise<void> {
    const config = systemSetupConfigFromEnv(process.env as Record<string, string | undefined>);
    this.lastResult = await this.service.provisionInitialAdmin(config);
    this.logger.log(
      `provisionInitialAdmin: ${this.lastResult.status}${
        this.lastResult.status !== "disabled" ? ` (${this.lastResult.email})` : ""
      }`,
    );
  }

  getLastResult(): ProvisionResult | null {
    return this.lastResult;
  }
}

/**
 * SystemSetupModule — provisions the bootstrap admin on `OnModuleInit`.
 *
 * Reads `SYSTEM_SETUP_ADMIN_EMAIL` + `SYSTEM_SETUP_ADMIN_PASSWORD`
 * from env (`systemSetupConfigFromEnv()`); when both are set, calls
 * `provisionInitialAdmin()` exactly once per boot. Result is logged
 * and cached on `SystemSetupBootstrap.getLastResult()` for the
 * `/dev/system-setup` diagnostics endpoint.
 *
 * Iter-211 CF.SETUP.01 closure: the storage provider is now
 * `PrismaAdminProvisioningStorage` which writes to Better-Auth's
 * `users` + `accounts` tables. The previous `InMemoryAdminStorage`
 * stub re-provisioned on every cold start because the Map was
 * process-local — now the row persists across restarts and the
 * provisioning path is idempotent (existing-email check via
 * `findAdminByEmail`).
 */
@Module({
  imports: [PrismaModule],
  providers: [
    { provide: ADMIN_PROVISIONING_STORAGE, useClass: PrismaAdminProvisioningStorage },
    {
      provide: SystemSetupService,
      useFactory: (storage: AdminProvisioningStorage) => new SystemSetupService(storage),
      inject: [ADMIN_PROVISIONING_STORAGE],
    },
    SystemSetupBootstrap,
  ],
  exports: [SystemSetupService, SystemSetupBootstrap],
})
export class SystemSetupModule {}

export { ADMIN_PROVISIONING_STORAGE, SystemSetupBootstrap };
