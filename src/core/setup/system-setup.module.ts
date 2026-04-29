import { Inject, Injectable, type LoggerService, Logger, Module, type OnModuleInit } from '@nestjs/common';

import {
  type AdminProvisioningStorage,
  type AdminRecord,
  type ProvisionResult,
  SystemSetupService,
} from './system-setup.service.js';
import { systemSetupConfigFromEnv } from './system-setup-config.js';

const ADMIN_PROVISIONING_STORAGE = Symbol.for('lt:AdminProvisioningStorage');

/**
 * In-memory admin storage stub. Replaced with a Better-Auth-backed
 * adapter once Better-Auth's Prisma schema lands. For now: a single
 * Map<email, AdminRecord> that tracks the bootstrap admin within the
 * process lifetime — enough to make `provisionInitialAdmin()` exercise
 * its full path during boot.
 */
class InMemoryAdminStorage implements AdminProvisioningStorage {
  private readonly admins = new Map<string, AdminRecord>();

  async findAdminByEmail(email: string): Promise<AdminRecord | null> {
    return this.admins.get(email) ?? null;
  }

  async createAdmin(input: { email: string; password: string }): Promise<AdminRecord> {
    void input.password; // password is hashed by the future Better-Auth adapter
    const record: AdminRecord = { email: input.email };
    this.admins.set(record.email, record);
    return record;
  }
}

@Injectable()
class SystemSetupBootstrap implements OnModuleInit {
  private readonly logger: LoggerService = new Logger('SystemSetup');
  private lastResult: ProvisionResult | null = null;

  constructor(
    @Inject(ADMIN_PROVISIONING_STORAGE) storage: AdminProvisioningStorage,
    @Inject(SystemSetupService) private readonly service: SystemSetupService = new SystemSetupService(storage),
  ) {}

  async onModuleInit(): Promise<void> {
    const config = systemSetupConfigFromEnv(process.env as Record<string, string | undefined>);
    this.lastResult = await this.service.provisionInitialAdmin(config);
    this.logger.log(`provisionInitialAdmin: ${this.lastResult.status}${
      this.lastResult.status !== 'disabled' ? ` (${this.lastResult.email})` : ''
    }`);
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
 * Storage is currently a process-local stub. Once Better-Auth's
 * Prisma adapter lands, the storage provider here swaps to a
 * Better-Auth-backed adapter without touching the bootstrap.
 */
@Module({
  providers: [
    { provide: ADMIN_PROVISIONING_STORAGE, useClass: InMemoryAdminStorage },
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
