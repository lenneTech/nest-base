import { describe, expect, it, vi } from "vitest";

import {
  SystemSetupService,
  type AdminProvisioningStorage,
} from "../../src/core/setup/system-setup.service.js";

/**
 * Story · System-Setup (Initial-Admin)
 *
 * On first boot the server provisions a single bootstrap admin from
 * the validated config (see iteration 4 / `system-setup-config.ts`).
 * Provisioning is idempotent: re-running with the same credentials
 * must not recreate the user. Disabled config short-circuits to a noop.
 */
describe("Story · System-Setup (Initial-Admin)", () => {
  function makeStorage(
    initial: { email: string }[] = [],
  ): AdminProvisioningStorage & { records: Set<string>; calls: number } {
    const records = new Set(initial.map((r) => r.email));
    let calls = 0;
    return {
      get records() {
        return records;
      },
      get calls() {
        return calls;
      },
      async findAdminByEmail(email: string): Promise<{ email: string } | null> {
        return records.has(email) ? { email } : null;
      },
      async createAdmin(input: { email: string; password: string }): Promise<{ email: string }> {
        calls += 1;
        records.add(input.email);
        return { email: input.email };
      },
    };
  }

  it("creates the admin when the config is enabled and no admin exists", async () => {
    const storage = makeStorage();
    const svc = new SystemSetupService(storage);
    const result = await svc.provisionInitialAdmin({
      adminEmail: "admin@example.com",
      adminPassword: "super-secret-12345",
      enabled: true,
    });
    expect(result).toEqual({ status: "created", email: "admin@example.com" });
    expect(storage.records.has("admin@example.com")).toBe(true);
    expect(storage.calls).toBe(1);
  });

  it("is idempotent — running twice with the same config calls createAdmin once", async () => {
    const storage = makeStorage();
    const svc = new SystemSetupService(storage);
    await svc.provisionInitialAdmin({
      adminEmail: "admin@example.com",
      adminPassword: "super-secret-12345",
      enabled: true,
    });
    const second = await svc.provisionInitialAdmin({
      adminEmail: "admin@example.com",
      adminPassword: "super-secret-12345",
      enabled: true,
    });
    expect(second).toEqual({ status: "already_exists", email: "admin@example.com" });
    expect(storage.calls).toBe(1);
  });

  it("short-circuits to status=disabled when enabled=false", async () => {
    const storage = makeStorage();
    const create = vi.spyOn(storage, "createAdmin");
    const svc = new SystemSetupService(storage);
    const result = await svc.provisionInitialAdmin({
      adminEmail: "admin@example.com",
      adminPassword: "super-secret-12345",
      enabled: false,
    });
    expect(result).toEqual({ status: "disabled" });
    expect(create).not.toHaveBeenCalled();
  });

  it("does not create when an admin with the same email already exists from outside provisioning", async () => {
    const storage = makeStorage([{ email: "admin@example.com" }]);
    const create = vi.spyOn(storage, "createAdmin");
    const svc = new SystemSetupService(storage);
    const result = await svc.provisionInitialAdmin({
      adminEmail: "admin@example.com",
      adminPassword: "super-secret-12345",
      enabled: true,
    });
    expect(result.status).toBe("already_exists");
    expect(create).not.toHaveBeenCalled();
  });

  it("propagates storage errors with a deterministic message", async () => {
    const failing: AdminProvisioningStorage = {
      async findAdminByEmail(): Promise<null> {
        return null;
      },
      async createAdmin(): Promise<never> {
        throw new Error("db down");
      },
    };
    const svc = new SystemSetupService(failing);
    await expect(
      svc.provisionInitialAdmin({
        adminEmail: "admin@example.com",
        adminPassword: "super-secret-12345",
        enabled: true,
      }),
    ).rejects.toThrow(/system-setup.*db down/i);
  });
});
