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
 */

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
  `[seed] plan: ${plan.tenants.length} tenants, ${plan.users.length} users, ${plan.tenantMembers.length} memberships`,
);

const prisma = new PrismaClient();

try {
  for (const tenant of plan.tenants) {
    await prisma.tenant.upsert({
      where: { id: tenant.id },
      create: { id: tenant.id, name: tenant.name, createdAt: tenant.createdAt },
      update: { name: tenant.name },
    });
  }
  console.log(`[seed]   tenants: ${plan.tenants.length}`);

  for (const user of plan.users) {
    await prisma.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        email: user.email,
        tenantId: user.tenantId,
        createdAt: user.createdAt,
      },
      update: { email: user.email, tenantId: user.tenantId },
    });
  }
  console.log(`[seed]   users:    ${plan.users.length}`);

  for (const member of plan.tenantMembers) {
    await prisma.tenantMember.upsert({
      where: { id: member.id },
      create: {
        id: member.id,
        userId: member.userId,
        tenantId: member.tenantId,
        role: member.role,
        status: member.status,
        joinedAt: member.joinedAt,
        createdAt: member.createdAt,
      },
      update: { role: member.role, status: member.status },
    });
  }
  console.log(`[seed]   members:  ${plan.tenantMembers.length}`);

  console.log("[seed] done.");
} finally {
  await prisma.$disconnect();
}
