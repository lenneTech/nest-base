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
  `[seed] plan: ${plan.tenants.length} tenants, ${plan.users.length} users, ${plan.tenantMembers.length} memberships`,
);

// Prisma 7 needs an explicit driver adapter — same wiring as
// PrismaService (src/core/prisma/prisma.service.ts).
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

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
