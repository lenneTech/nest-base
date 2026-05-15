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
  /**
   * Create the admin account. Implementations MUST be idempotent:
   * when an admin with the same email already exists, they MUST return
   * `{ status: "already_exists" }` rather than throwing. This collapses
   * the previous find-then-create two-step into a single DB round-trip
   * (upsert or P2002-catch), eliminating the TOCTOU race window.
   */
  createAdmin(input: {
    email: string;
    password: string;
  }): Promise<{ record: AdminRecord; status: "created" | "already_exists" }>;
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

    // Single DB call: createAdmin is idempotent and returns whether it
    // actually created a new row or found an existing one. This replaces
    // the previous find-then-create pattern which had a TOCTOU race
    // window: two concurrent boots could both see "no admin exists" and
    // both attempt to create, causing one to fail with P2002.
    try {
      const result = await this.storage.createAdmin({
        email: config.adminEmail,
        password: config.adminPassword,
      });
      return { status: result.status, email: result.record.email };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`system-setup: failed to provision initial admin (${reason})`);
    }
  }
}
