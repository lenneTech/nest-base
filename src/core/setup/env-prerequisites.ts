/**
 * Pure pre-boot check for the minimum env-vars the server needs to
 * start. Runs before `NestFactory.create()` so a missing `.env`
 * surfaces as a friendly banner with copy-paste fix instructions
 * instead of a stack trace from deep inside Better-Auth or Prisma.
 *
 * No I/O. The runner in `bootstrap.ts` reads `process.env` and
 * detects whether `.env` / `.env.example` exist on disk, and feeds
 * that into the planner.
 */

export interface EnvPrerequisitesInput {
  /** Snapshot of `process.env` (we only read selected keys). */
  env: Record<string, string | undefined>;
  /** True when `.env` exists in the project root. */
  envFileExists: boolean;
  /** True when `.env.example` exists in the project root. */
  envExampleExists: boolean;
}

export interface MissingEnvVar {
  key: string;
  hint: string;
}

export interface EnvPrerequisitesPlan {
  ok: boolean;
  /** Empty when ok. */
  missing: MissingEnvVar[];
  /** True when `.env` is missing entirely (helps render a different intro). */
  envFileMissing: boolean;
  /** True when both `.env` and `.env.example` are missing — the worst case. */
  envExampleMissing: boolean;
}

/** Variables the server cannot start without. */
const REQUIRED: ReadonlyArray<MissingEnvVar> = [
  {
    key: "DATABASE_URL",
    hint: "Postgres connection string (e.g. postgresql://user:pass@localhost:5432/db).",
  },
  {
    key: "BETTER_AUTH_SECRET",
    hint: "≥ 32-byte random secret used to sign sessions.",
  },
];

export function checkEnvPrerequisites(input: EnvPrerequisitesInput): EnvPrerequisitesPlan {
  const missing: MissingEnvVar[] = [];
  for (const r of REQUIRED) {
    const value = input.env[r.key];
    if (!value || value === "" || value.startsWith("change-me")) {
      missing.push(r);
    }
  }
  return {
    ok: missing.length === 0,
    missing,
    envFileMissing: !input.envFileExists,
    envExampleMissing: !input.envFileExists && !input.envExampleExists,
  };
}

/** ANSI-coloured help banner. Pure formatter; no side effects. */
export function renderEnvBanner(plan: EnvPrerequisitesPlan): string {
  const RESET = "\x1b[0m";
  const BOLD = "\x1b[1m";
  const DIM = "\x1b[2m";
  const RED = "\x1b[31m";
  const GREEN = "\x1b[32m";
  const YELLOW = "\x1b[33m";
  const CYAN = "\x1b[36m";
  const HR = `${DIM}${"─".repeat(72)}${RESET}`;

  const lines: string[] = [];
  lines.push("");
  lines.push(HR);
  lines.push(`${BOLD}${RED}✗ Missing required environment variables${RESET}`);
  lines.push("");

  if (plan.envFileMissing) {
    // `bun run setup` auto-creates .env.example (if missing) and .env
    // with strong randomly-generated secrets in one step. No `cp`
    // dance needed — and the wizard refuses to overwrite an existing
    // .env, so doing the copy first would actually block setup.
    lines.push(`${YELLOW}No .env file found.${RESET} Generate one with strong random secrets:`);
    lines.push("");
    lines.push(`  ${BOLD}${CYAN}bun run setup${RESET}`);
    lines.push("");
    lines.push(
      `${DIM}The wizard writes .env (and .env.example if missing) with project-local${RESET}`,
    );
    lines.push(
      `${DIM}values for DATABASE_URL, BETTER_AUTH_SECRET, and the other prerequisites.${RESET}`,
    );
  } else {
    lines.push(
      `${YELLOW}.env is present but the following keys are empty or still set to a "change-me-*" placeholder:${RESET}`,
    );
    lines.push("");
    for (const m of plan.missing) {
      lines.push(`  ${BOLD}${RED}✗${RESET} ${BOLD}${m.key}${RESET}`);
      lines.push(`     ${DIM}${m.hint}${RESET}`);
    }
    lines.push("");
    lines.push(
      `${DIM}Delete .env and re-run ${RESET}${BOLD}${CYAN}bun run setup${RESET}${DIM} to regenerate with fresh${RESET}`,
    );
    lines.push(`${DIM}auto-generated secrets, or edit .env manually.${RESET}`);
  }

  lines.push("");
  lines.push(HR);
  lines.push(
    `${DIM}Once .env is in place, run ${RESET}${BOLD}${GREEN}bun run dev${RESET}${DIM} again.${RESET}`,
  );
  lines.push("");

  return lines.join("\n");
}
