import { Inject, Injectable, Logger } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";

import type { AdminProvisioningStorage, AdminRecord } from "./system-setup.service.js";

/**
 * Prisma-backed admin provisioning storage (CF.SETUP.01 closure —
 * iter-211).
 *
 * Replaces the iter-pre-211 `InMemoryAdminStorage` stub. Reads/writes
 * Better-Auth's `User` table directly via Prisma:
 *   - `findAdminByEmail` queries the `users` table for an existing row.
 *   - `createAdmin` hashes the password via Better-Auth's canonical
 *     `hashPassword` (scrypt, matching every other production
 *     password-write path) and inserts the user + a matching `Account`
 *     row carrying the credential hash. Better-Auth resolves passwords
 *     via the `accounts` table, so the bootstrap admin's password is
 *     persisted in the same shape as a sign-up flow would produce.
 *
 * The bootstrap admin is just a User row; the operator promotes them
 * to administrator via Better-Auth's `admin` plugin role assignment
 * once they sign in.
 */
@Injectable()
export class PrismaAdminProvisioningStorage implements AdminProvisioningStorage {
  private readonly logger = new Logger("AdminProvisioningStorage");

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findAdminByEmail(email: string): Promise<AdminRecord | null> {
    const row = await this.prisma.user.findFirst({
      where: { email },
      select: { id: true, email: true },
    });
    return row ? { email: row.email } : null;
  }

  async createAdmin(input: { email: string; password: string }): Promise<AdminRecord> {
    // Better-Auth's `hashPassword` uses scrypt with the same parameters
    // every sign-up flow uses, so the bootstrap admin's hash is
    // verifiable via the standard `accounts` lookup at sign-in.
    const { hashPassword } = await import("better-auth/crypto");
    const passwordHash = await hashPassword(input.password);

    // Create User + matching Account in one transaction so a partial
    // failure can't leave the row half-provisioned. Concurrent boots
    // (e.g. the heap-budget harness spawns several Nest apps in
    // parallel) race against the unique `email` index — catch
    // P2002 and surface the existing row so the service treats the
    // outcome as `already_exists` rather than crashing the boot.
    try {
      await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: input.email,
            name: input.email,
            emailVerified: true,
          },
        });
        await tx.account.create({
          data: {
            userId: user.id,
            providerId: "credential",
            accountId: input.email,
            password: passwordHash,
          },
        });
      });
      this.logger.log(`bootstrap admin provisioned (email=${input.email})`);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        this.logger.log(
          `bootstrap admin already exists (concurrent provisioning, email=${input.email})`,
        );
      } else {
        throw err;
      }
    }
    return { email: input.email };
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  // Prisma's `PrismaClientKnownRequestError.code === "P2002"` is the
  // unique-constraint violation. We don't want a `instanceof` check
  // against the runtime class because that pulls the heavy Prisma
  // engine import — pattern-match on the duck-typed error shape
  // instead.
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  return e.code === "P2002";
}
