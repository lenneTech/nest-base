import type { SystemSetupConfig } from "./system-setup-config.js";

/**
 * System-Setup.
 *
 * On first boot the server provisions a single bootstrap admin from
 * env-var-derived config. The service is intentionally
 * storage-agnostic — it depends on a small `AdminProvisioningStorage`
 * interface so the actual user creation can be backed by Better-Auth
 * once its Prisma adapter lands without churning this code.
 */

export interface AdminRecord {
  email: string;
}

export interface AdminProvisioningStorage {
  findAdminByEmail(email: string): Promise<AdminRecord | null>;
  createAdmin(input: { email: string; password: string }): Promise<AdminRecord>;
}

export type ProvisionResult =
  | { status: "created"; email: string }
  | { status: "already_exists"; email: string }
  | { status: "disabled" };

export class SystemSetupService {
  constructor(private readonly storage: AdminProvisioningStorage) {}

  async provisionInitialAdmin(config: SystemSetupConfig): Promise<ProvisionResult> {
    if (!config.enabled) {
      return { status: "disabled" };
    }

    const existing = await this.storage.findAdminByEmail(config.adminEmail);
    if (existing) {
      return { status: "already_exists", email: existing.email };
    }

    try {
      const created = await this.storage.createAdmin({
        email: config.adminEmail,
        password: config.adminPassword,
      });
      return { status: "created", email: created.email };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`system-setup: failed to provision initial admin (${reason})`);
    }
  }
}
