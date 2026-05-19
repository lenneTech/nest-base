#!/usr/bin/env bun
/**
 * `bun run setup` — generate `.env`, optional full dev bootstrap.
 *
 * Fresh checkout (default):
 *   1. Write `.env` from `.env.example` with random secrets
 *   2. Start Postgres (+ Redis), prepare schema, migrate, seed
 *   3. Print `bun run dev`
 *
 * Flags:
 *   --bootstrap     Run DB bring-up even when `.env` already exists
 *   --skip-bootstrap  Only write `.env` / env-bridge (no docker/prisma/seed)
 *   --skip-docker   Skip `docker compose up` (CI / manual stack)
 *   --no-seed       Migrate only — no demo data
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { config as loadEnv } from "dotenv";

import { computeComposeProjectName } from "../src/core/setup/compose-project-name.js";
import { findFreePort } from "../src/core/setup/find-free-port.js";
import { executeSetupBootstrap } from "../src/core/setup/setup-bootstrap-runner.js";
import { planSetupBootstrap } from "../src/core/setup/setup-bootstrap.js";
import { runSetupWizard } from "../src/core/setup/setup-wizard-runner.js";
import { planVolumeCollisionCheck } from "../src/core/setup/volume-collision-check.js";

const argv = process.argv.slice(2);
const bootstrapFlag = argv.includes("--bootstrap");
const skipBootstrap = argv.includes("--skip-bootstrap");
const skipDocker = argv.includes("--skip-docker") || process.env.SKIP_DB_BOOT === "1";
const skipSeed = argv.includes("--no-seed");

const projectRoot = process.cwd();
const logger = {
  info: (msg: string) => console.log(`[setup] ${msg}`),
  warn: (msg: string) => console.warn(`[setup] ${msg}`),
};

const postgresHostPort = await findFreePort(5432);
if (postgresHostPort !== 5432) {
  console.log(
    `[setup] port 5432 is busy — picking ${postgresHostPort} for this workspace's Postgres`,
  );
}

const result = runSetupWizard({
  projectRoot,
  logger,
  postgresHostPort,
});

const shouldBootstrap = (result.created || bootstrapFlag) && !skipBootstrap;

if (!result.created && !bootstrapFlag) {
  console.log("");
  console.log(
    "[setup] `.env` already exists — leaving it untouched. " +
      "Run `bun run setup --bootstrap` to start Postgres, migrate, and seed.",
  );
  process.exit(1);
}

if (result.created) {
  const composeProjectName = readComposeProjectName(projectRoot) ?? "nest-base";
  const volumeName = `${composeProjectName}_postgres_data`;
  const volumeProbe = spawnSync("docker", ["volume", "inspect", volumeName], {
    stdio: "pipe",
    encoding: "utf8",
  });
  const expectedComposeProjectName = readPackageJsonName(projectRoot)
    ? computeComposeProjectName({
        projectName: readPackageJsonName(projectRoot)!,
        workspacePath: projectRoot,
      })
    : undefined;
  const collisionPlan = planVolumeCollisionCheck({
    composeProjectName,
    volumeExists: volumeProbe.status === 0,
    expectedComposeProjectName,
  });

  if (!collisionPlan.ok) {
    console.error("");
    console.error(collisionPlan.message);
    console.error("");
    console.error("Aborting before bootstrap would fail with P1000.");
    process.exit(2);
  }
}

if (!shouldBootstrap) {
  console.log("");
  console.log("Next steps:");
  console.log("  1. Review values in .env");
  console.log("  2. Run: bun run setup --bootstrap");
  console.log("  3. Or manually: docker compose up -d && bun run prepare:schema");
  console.log("     && bun run prisma:generate && bun run prisma:migrate && bun run seed");
  console.log("  4. Start: bun run dev");
  process.exit(0);
}

loadEnv({ path: join(projectRoot, ".env") });

const bootstrapPlan = planSetupBootstrap({
  env: { DATABASE_URL: process.env.DATABASE_URL },
  nodeEnv: process.env.NODE_ENV ?? "development",
  hasFeatureSchemas: existsSync(join(projectRoot, "prisma/features")),
  hasSeedScript: existsSync(join(projectRoot, "scripts/seed.ts")),
  hasDockerCompose: existsSync(join(projectRoot, "docker-compose.yml")),
  skipDocker,
  skipSeed,
});

if (!bootstrapPlan.allowed) {
  console.error(`[setup] bootstrap refused: ${bootstrapPlan.refusalReason}`);
  process.exit(3);
}

console.log("");
console.log("[setup] bootstrapping database (docker → schema → migrate → seed)…");
const bootstrapResult = await executeSetupBootstrap({ plan: bootstrapPlan, logger });

if (!bootstrapResult.ok) {
  console.error("");
  console.error(
    `[setup] bootstrap failed${bootstrapResult.failedStep ? ` at "${bootstrapResult.failedStep.verb}"` : ""}.`,
  );
  console.error("Fix the issue above, then re-run: bun run setup --bootstrap");
  process.exit(4);
}

console.log("");
console.log("[setup] ready.");
console.log("  Start the dev server:  bun run dev");
console.log("  Hub login (after seed):  system-admin@lenne.tech / system-admin");
console.log("                         admin@lenne.tech / admin");
console.log("  Sanity check:          bun run onboard");

function readComposeProjectName(cwd: string): string | undefined {
  const envPath = join(cwd, ".env");
  if (!existsSync(envPath)) return undefined;
  const text = readFileSync(envPath, "utf8");
  const match = /^COMPOSE_PROJECT_NAME=(.*)$/m.exec(text);
  return match?.[1]?.trim() || undefined;
}

function readPackageJsonName(cwd: string): string | undefined {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  const match = /"name"\s*:\s*"([^"]+)"/.exec(readFileSync(pkgPath, "utf8"));
  return match?.[1];
}
