/**
 * Onboard report builder.
 *
 * Pure planner. The CLI runner collects the inputs (Bun version,
 * env-file presence, Postgres reachability, Prisma client +
 * migrations status) and pipes them through here to produce the
 * checklist a fresh contributor sees when they run
 * `bun run onboard`.
 *
 * Two-tier severity: BLOCKED stops onboarding (the runner exits
 * non-zero), WARNING is a "you can keep going but should fix this"
 * (the runner prints the hint, returns 0).
 *
 * Keeping the planner I/O-free buys deterministic tests and lets
 * us reuse the same shape in fixtures, the runner, and a future
 * `/hub/onboarding` page.
 */

export type OnboardStatus = "ok" | "warning" | "blocked";

export interface OnboardChecklistInput {
  bunVersion?: string;
  requiredBunVersion: string;
  envFileExists: boolean;
  postgresReachable: boolean;
  prismaClientGenerated: boolean;
  migrationsUpToDate: boolean;
}

export interface OnboardStep {
  id: string;
  label: string;
  status: OnboardStatus;
  detail?: string;
  remediation?: string;
}

export interface OnboardReport {
  kind: "onboard-report";
  version: 1;
  steps: OnboardStep[];
  summary: { ok: number; warning: number; blocked: number };
  ok: boolean;
}

export function buildOnboardReport(input: OnboardChecklistInput): OnboardReport {
  const steps: OnboardStep[] = [
    bunStep(input),
    envStep(input),
    postgresStep(input),
    prismaGenerateStep(input),
    migrationsStep(input),
  ];

  const summary = { ok: 0, warning: 0, blocked: 0 };
  for (const step of steps) summary[step.status]++;

  return {
    kind: "onboard-report",
    version: 1,
    steps,
    summary,
    ok: summary.blocked === 0,
  };
}

function bunStep(input: OnboardChecklistInput): OnboardStep {
  const id = "bun";
  const label = `Bun ≥ ${input.requiredBunVersion}`;
  if (!input.bunVersion) {
    return {
      id,
      label,
      status: "blocked",
      detail: "Bun is not installed (or not on PATH)",
      remediation: "Install Bun: curl -fsSL https://bun.sh/install | bash",
    };
  }
  if (compareSemver(input.bunVersion, input.requiredBunVersion) < 0) {
    return {
      id,
      label,
      status: "blocked",
      detail: `Bun ${input.bunVersion} is too old`,
      remediation: `Upgrade Bun (\`bun upgrade\`) to at least ${input.requiredBunVersion}`,
    };
  }
  return { id, label, status: "ok", detail: `Bun ${input.bunVersion}` };
}

function envStep(input: OnboardChecklistInput): OnboardStep {
  const id = "env";
  const label = ".env file present";
  if (!input.envFileExists) {
    return {
      id,
      label,
      status: "blocked",
      detail: ".env is missing",
      remediation: "Run: cp .env.example .env",
    };
  }
  return { id, label, status: "ok" };
}

function postgresStep(input: OnboardChecklistInput): OnboardStep {
  const id = "postgres";
  const label = "Postgres reachable";
  if (!input.postgresReachable) {
    return {
      id,
      label,
      status: "blocked",
      detail: "Postgres is not reachable from DATABASE_URL",
      remediation: "Start the dev stack: docker compose up -d",
    };
  }
  return { id, label, status: "ok" };
}

function prismaGenerateStep(input: OnboardChecklistInput): OnboardStep {
  const id = "prisma-generate";
  const label = "Prisma client generated";
  if (!input.prismaClientGenerated) {
    return {
      id,
      label,
      status: "warning",
      detail: "Prisma client has not been generated yet",
      remediation: "Run: bunx prisma generate",
    };
  }
  return { id, label, status: "ok" };
}

function migrationsStep(input: OnboardChecklistInput): OnboardStep {
  const id = "migrations";
  const label = "Migrations up to date";
  if (!input.migrationsUpToDate) {
    return {
      id,
      label,
      status: "warning",
      detail: "Database schema is behind the migration history",
      remediation: "Run: bun run prisma:migrate (or bunx prisma migrate dev)",
    };
  }
  return { id, label, status: "ok" };
}

/** Returns negative if a<b, 0 if equal, positive if a>b. Tolerates trailing pre-release tags. */
function compareSemver(a: string, b: string): number {
  const partsA = a
    .split("-")[0]!
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  const partsB = b
    .split("-")[0]!
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const x = partsA[i] ?? 0;
    const y = partsB[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}
