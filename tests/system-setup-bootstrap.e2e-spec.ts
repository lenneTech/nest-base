import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";
import { PrismaService } from "../src/core/prisma/prisma.service.js";
import { SystemSetupBootstrap } from "../src/core/setup/system-setup.module.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * `SystemSetupModule` provisions the bootstrap admin on `OnModuleInit`
 * when both `SYSTEM_SETUP_ADMIN_EMAIL` + `SYSTEM_SETUP_ADMIN_PASSWORD`
 * are present in the env. The result is cached on the bootstrap
 * provider for diagnostics.
 */
describe("SystemSetupModule · OnModuleInit boot hook", () => {
  describe("with admin credentials in env", () => {
    let app: INestApplication;
    // Per-suite admin email so the iter-211 Prisma-backed storage's
    // existing-row check doesn't see an admin from a prior test run.
    const adminEmail = `setup-bootstrap-${crypto.randomUUID()}@example.com`;

    beforeAll(async () => {
      process.env.SYSTEM_SETUP_ADMIN_EMAIL = adminEmail;
      process.env.SYSTEM_SETUP_ADMIN_PASSWORD = "a-strong-password-12";
      app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    });

    afterAll(async () => {
      // Clean up the user we just created so concurrent specs see a
      // pristine table.
      try {
        const prisma = app.get(PrismaService);
        await prisma.user.deleteMany({ where: { email: adminEmail } });
      } catch {
        /* best-effort */
      }
      await app.close();
      delete process.env.SYSTEM_SETUP_ADMIN_EMAIL;
      delete process.env.SYSTEM_SETUP_ADMIN_PASSWORD;
    });

    it("runs provisionInitialAdmin and reports success", () => {
      const bootstrapProvider = app.get(SystemSetupBootstrap);
      const result = bootstrapProvider.getLastResult();
      if (!result) throw new Error("expected provisionInitialAdmin to have run");
      expect(result.status).toBe("created");
      if (result.status === "created") {
        expect(result.email).toBe(adminEmail);
      }
    });
  });

  describe("without admin credentials in env", () => {
    let app: INestApplication;

    beforeAll(async () => {
      delete process.env.SYSTEM_SETUP_ADMIN_EMAIL;
      delete process.env.SYSTEM_SETUP_ADMIN_PASSWORD;
      app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    });

    afterAll(async () => {
      await app.close();
    });

    it("reports `disabled` and does not crash", () => {
      const bootstrapProvider = app.get(SystemSetupBootstrap);
      const result = bootstrapProvider.getLastResult();
      expect(result).not.toBeNull();
      expect(result!.status).toBe("disabled");
    });
  });
});
