#!/usr/bin/env bun
/**
 * `bun run seed` — insert demo data into the local DB.
 *
 * Pure planner (`buildSeedPlan()`) lives in
 * `src/core/setup/seed-plan.ts`. This file is the thin runner: spin
 * up Prisma, upsert each row from the plan. Idempotent — every id
 * is deterministic so re-running the seed matches existing rows.
 *
 * Refuses on `NODE_ENV=production` and on non-local DATABASE_URL
 * hosts (defense-in-depth — `bun run reset` does the same check
 * before clearing data).
 *
 * The runner hashes each user's plain-text password via Better-Auth's
 * canonical scrypt hasher (`hashPassword` from `better-auth/crypto`)
 * before writing the `Account` row — the same function used by
 * Better-Auth's email/password sign-up flow, so sign-in works without
 * any password-hash migration.
 */

import { createHash } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { buildSeedPlan } from "../src/core/setup/seed-plan.js";

if (process.env.NODE_ENV === "production") {
  console.error("[seed] refusing: NODE_ENV=production. `bun run seed` is dev-only.");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("[seed] refusing: DATABASE_URL is not set.");
  process.exit(1);
}

const host = (() => {
  try {
    return new URL(process.env.DATABASE_URL).hostname;
  } catch {
    return null;
  }
})();
if (!host || (host.includes(".") && host !== "localhost")) {
  console.error(`[seed] refusing: DATABASE_URL host "${host}" looks non-local.`);
  process.exit(1);
}

const plan = buildSeedPlan();
console.log(
  `[seed] plan: ${plan.roles.length} roles, ` +
    `${plan.policies.length} policies, ${plan.permissions.length} permissions, ` +
    `${plan.users.length} users, ${plan.userProfiles.length} profiles, ` +
    `${plan.organizations.length} BA orgs, ${plan.baMembers.length} BA members`,
);

// Prisma 7 needs an explicit driver adapter — same wiring as
// PrismaService (src/core/prisma/prisma.service.ts).
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// Hash passwords up front so we only import better-auth/crypto once
// and avoid mixing async imports inside the try/finally block.
const { hashPassword } = await import("better-auth/crypto");
const passwordHashes = await Promise.all(plan.users.map((user) => hashPassword(user.password)));

try {
  // Roles
  for (const role of plan.roles) {
    await prisma.role.upsert({
      where: { id: role.id },
      create: {
        id: role.id,
        name: role.name,
        tenantId: role.tenantId,
        isSystem: role.isSystem,
        createdAt: role.createdAt,
      },
      update: { name: role.name, isSystem: role.isSystem },
    });
  }
  console.log(`[seed]   roles:       ${plan.roles.length}`);

  // Policies
  for (const policy of plan.policies) {
    await prisma.policy.upsert({
      where: { id: policy.id },
      create: {
        id: policy.id,
        name: policy.name,
        description: policy.description,
        createdAt: policy.createdAt,
      },
      update: { name: policy.name, description: policy.description },
    });
  }
  console.log(`[seed]   policies:    ${plan.policies.length}`);

  // RolePolicies (composite PK — upsert by composite key)
  for (const rp of plan.rolePolicies) {
    await prisma.rolePolicy.upsert({
      where: { roleId_policyId: { roleId: rp.roleId, policyId: rp.policyId } },
      create: { roleId: rp.roleId, policyId: rp.policyId },
      update: {},
    });
  }
  console.log(`[seed]   rolePolicies: ${plan.rolePolicies.length}`);

  // Permissions
  for (const perm of plan.permissions) {
    // Permission.action is a DB enum (PermissionAction). The "MANAGE"
    // bypass row must use a valid enum value — we store it as "CREATE"
    // with a special resource="all" to distinguish it, OR we use the
    // upsert with a cast. Since the DB enum doesn't include "MANAGE",
    // we store the bypass as "CREATE" on resource "all" (the CASL
    // ability builder reads it via db-rule-resolver which lowercases
    // it; "manage:all" is expressed differently in the DB by convention).
    //
    // However: looking at the existing codebase, the Permission enum is:
    //   CREATE | READ | UPDATE | DELETE | SHARE
    // "MANAGE" is synthesized in-memory (never persisted). To store the
    // bypass we use "CREATE" with resource="all" and no itemFilter — the
    // db-rule-resolver will lowercase "create" but the PrismaPermissionStorage
    // won't see this row via the normal member-rules path anyway.
    //
    // For the Admin/User rows that use "MANAGE", we store them as the
    // real DB-compatible equivalent: separate CREATE+READ+UPDATE+DELETE
    // rows, OR we store a "READ" row on the "all" resource to signal
    // the bypass in the admin-policy slot. The cleanest approach that
    // lets PrismaPermissionStorage resolve them correctly is to store
    // one Permission row per (action, resource) pair from the DB enum.
    //
    // For Admin "MANAGE" on project resources we expand to 4 rows
    // (CREATE, READ, UPDATE, DELETE) in the DB.
    if (perm.action === "MANAGE") {
      // Expand manage → 4 DB actions. For the "all" bypass (System Admin)
      // resource="all" carries the semantics; for project resources
      // resource=<resource>.
      const dbActions: Array<"CREATE" | "READ" | "UPDATE" | "DELETE"> = [
        "CREATE",
        "READ",
        "UPDATE",
        "DELETE",
      ];
      for (const action of dbActions) {
        const expandedId = seededExpandedId(perm.id, action);
        await prisma.permission.upsert({
          where: { id: expandedId },
          create: {
            id: expandedId,
            policyId: perm.policyId,
            resource: perm.resource,
            action,
            itemFilter: perm.itemFilter ?? undefined,
            fields: perm.fields,
            createdAt: perm.createdAt,
          },
          update: {
            itemFilter: perm.itemFilter ?? undefined,
            fields: perm.fields,
          },
        });
      }
    } else {
      await prisma.permission.upsert({
        where: { id: perm.id },
        create: {
          id: perm.id,
          policyId: perm.policyId,
          resource: perm.resource,
          action: perm.action,
          itemFilter: perm.itemFilter ?? undefined,
          fields: perm.fields,
          createdAt: perm.createdAt,
        },
        update: {
          itemFilter: perm.itemFilter ?? undefined,
          fields: perm.fields,
        },
      });
    }
  }
  console.log(`[seed]   permissions: ${plan.permissions.length} (expanded to DB enum rows)`);

  // Users
  for (const user of plan.users) {
    await prisma.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
      },
      update: { email: user.email, name: user.name },
    });
  }
  console.log(`[seed]   users:       ${plan.users.length}`);

  // Account rows (credential auth) — hashed passwords
  for (let i = 0; i < plan.users.length; i++) {
    const user = plan.users[i]!;
    const passwordHash = passwordHashes[i]!;
    // `accountId` mirrors Better-Auth's convention: uses the user's email
    // as the accountId for the "credential" provider (consistent with
    // what `admin-storage.prisma.ts` does for the bootstrap admin).
    await prisma.account.upsert({
      where: {
        // Prisma's unique index is on (userId, providerId) in Better-Auth's
        // schema, but the Prisma schema doesn't expose a named composite
        // unique. We upsert by id (deterministic) to stay idempotent.
        id: seededAccountId(user.id),
      },
      create: {
        id: seededAccountId(user.id),
        userId: user.id,
        accountId: user.email,
        providerId: "credential",
        password: passwordHash,
        createdAt: user.createdAt,
      },
      update: {
        // Re-hash on every re-seed so a manual password change in the
        // dev DB can be reset by re-running `bun run seed`.
        password: passwordHash,
      },
    });
  }
  console.log(`[seed]   accounts:    ${plan.users.length}`);

  // UserProfiles
  for (const profile of plan.userProfiles) {
    await prisma.userProfile.upsert({
      where: { id: profile.id },
      create: {
        id: profile.id,
        userId: profile.userId,
        tenantId: profile.tenantId,
        displayName: profile.displayName,
        createdAt: profile.createdAt,
      },
      update: { displayName: profile.displayName },
    });
  }
  console.log(`[seed]   profiles:    ${plan.userProfiles.length}`);

  // BA Organization rows (issue #118) — canonical tenant layer.
  // The prisma adapter writes TEXT ids; our UUIDs are valid TEXT so
  // no cast is needed here — Prisma handles the mapping.
  for (const org of plan.organizations) {
    await prisma.organization.upsert({
      where: { id: org.id },
      create: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        createdAt: org.createdAt,
      },
      update: { name: org.name, slug: org.slug },
    });
  }
  console.log(`[seed]   BA orgs:     ${plan.organizations.length}`);

  // BA Member rows (issue #118) — canonical membership layer.
  for (const baMember of plan.baMembers) {
    await prisma.member.upsert({
      where: { id: baMember.id },
      create: {
        id: baMember.id,
        organizationId: baMember.organizationId,
        userId: baMember.userId,
        role: baMember.role,
        createdAt: baMember.createdAt,
      },
      update: { role: baMember.role },
    });
  }
  console.log(`[seed]   BA members:  ${plan.baMembers.length}`);

  console.log("[seed] done.");
  console.log("");
  console.log("[seed] Demo credentials:");
  console.log("[seed]   system-admin@lenne.tech / system-admin");
  console.log("[seed]   admin@lenne.tech        / admin");
  console.log("[seed]   user@lenne.tech         / user");
} catch (err) {
  // Prisma P2021 = "The table … does not exist". Most common cause is
  // running `bun run seed` before applying migrations on a fresh DB.
  // Print a friendly hint instead of dumping the full Prisma stack.
  const code = (err as { code?: string }).code;
  if (code === "P2021") {
    console.error("[seed] DB schema is missing — run migrations first:");
    console.error("[seed]   bun run prepare:schema && bun run prisma:migrate");
    console.error("[seed]   bun run seed");
    console.error("[seed] (or `bun run reset` to wipe + migrate + seed in one shot)");
    process.exit(1);
  }
  throw err;
} finally {
  await prisma.$disconnect();
}

/**
 * When we expand a MANAGE permission into 4 DB-enum rows we need a
 * stable id per (permId, action) pair. XOR the last 4 hex chars with
 * a small action-specific salt so every expanded row has a unique but
 * deterministic UUID that won't collide with the parent row.
 */
function seededExpandedId(baseId: string, action: string): string {
  const suffix = createHash("sha256").update(`${baseId}:${action}`).digest("hex").slice(0, 12);
  // Replace the last 12 hex chars of the base UUID tail segment.
  const parts = baseId.split("-");
  // UUID format: 8-4-4-4-12. Replace the 12-char tail.
  return `${parts[0]}-${parts[1]}-${parts[2]}-${parts[3]}-${suffix}`;
}

/**
 * Deterministic Account id derived from the user id.
 * Keeps re-seeds idempotent: upsert by this id matches the existing row.
 */
function seededAccountId(userId: string): string {
  const digest = createHash("sha256").update(`account:${userId}`).digest("hex");
  // Format as UUID v4-shaped (fixed version/variant nibbles won't fire
  // DB format checks since the column is just VARCHAR).
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
