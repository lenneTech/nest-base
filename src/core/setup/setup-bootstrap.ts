/**
 * Pure planner for the post-`.env` bring-up chain (`bun run setup --bootstrap`
 * or automatic on a freshly written `.env`).
 *
 * Replaces the manual dance:
 *   docker compose up -d → prepare:schema → prisma:generate → prisma:migrate → seed
 */

export interface SetupBootstrapEnv {
  DATABASE_URL?: string;
}

export interface SetupBootstrapInput {
  env: SetupBootstrapEnv;
  nodeEnv: string;
  /** `prisma/features/*.prisma` present — run `prepare:schema` first. */
  hasFeatureSchemas: boolean;
  /** `scripts/seed.ts` present — run demo seed at the end. */
  hasSeedScript: boolean;
  /** `docker-compose.yml` at project root — start Postgres (+ Redis when enabled). */
  hasDockerCompose: boolean;
  /** Skip `docker compose up` (CI / manual stack). */
  skipDocker?: boolean;
  /** Skip demo seed (schema-only bootstrap). */
  skipSeed?: boolean;
  /** Start Redis alongside Postgres (needed before `/health/ready` is green). */
  includeRedis?: boolean;
}

export type SetupBootstrapStepVerb =
  | "compose-up"
  | "wait-postgres"
  | "prepare-schema"
  | "generate"
  | "migrate"
  | "seed";

export interface SetupBootstrapStep {
  verb: SetupBootstrapStepVerb;
  /** `wait-postgres` is handled in-process (TCP probe), not spawned. */
  command: "docker" | "bun" | "bunx" | "internal";
  args: string[];
  env: Record<string, string>;
  description: string;
}

export interface SetupBootstrapPlan {
  allowed: boolean;
  steps: SetupBootstrapStep[];
  refusalReason?: string;
}

const LOCAL_HOST_ALLOWLIST = new Set(["localhost", "127.0.0.1", "::1"]);

export function planSetupBootstrap(input: SetupBootstrapInput): SetupBootstrapPlan {
  if (input.nodeEnv === "production") {
    return {
      allowed: false,
      steps: [],
      refusalReason: "refusing: NODE_ENV=production. Setup bootstrap is dev-only.",
    };
  }

  const url = input.env.DATABASE_URL;
  if (!url) {
    return {
      allowed: false,
      steps: [],
      refusalReason: "refusing: DATABASE_URL is not set (load `.env` before bootstrap).",
    };
  }

  const host = extractHost(url);
  if (!host || !isLocalHost(host)) {
    return {
      allowed: false,
      steps: [],
      refusalReason: `refusing: DATABASE_URL points at non-local host "${host ?? "<unparseable>"}".`,
    };
  }

  const env: Record<string, string> = { DATABASE_URL: url };
  const steps: SetupBootstrapStep[] = [];

  if (input.hasDockerCompose && !input.skipDocker) {
    const services = input.includeRedis === false ? ["postgres"] : ["postgres", "redis"];
    steps.push({
      verb: "compose-up",
      command: "docker",
      args: ["compose", "up", "-d", ...services],
      env,
      description: `Start ${services.join(" + ")} via docker compose`,
    });
    steps.push({
      verb: "wait-postgres",
      command: "internal",
      args: [],
      env,
      description: "Wait until Postgres accepts TCP connections",
    });
  }

  if (input.hasFeatureSchemas) {
    steps.push({
      verb: "prepare-schema",
      command: "bun",
      args: ["run", "scripts/prepare-schema.ts"],
      env,
      description: "Concatenate base schema + active feature schemas",
    });
  }

  steps.push({
    verb: "generate",
    command: "bunx",
    args: ["prisma", "generate"],
    env,
    description: "Generate Prisma client",
  });

  steps.push({
    verb: "migrate",
    command: "bunx",
    args: ["prisma", "migrate", "deploy"],
    env,
    description: "Apply database migrations",
  });

  if (input.hasSeedScript && !input.skipSeed) {
    steps.push({
      verb: "seed",
      command: "bun",
      args: ["run", "scripts/seed.ts"],
      env,
      description: "Insert demo tenant, roles, and operator users",
    });
  }

  return { allowed: true, steps };
}

function extractHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.hostname);
  } catch {
    return null;
  }
}

function isLocalHost(host: string): boolean {
  if (LOCAL_HOST_ALLOWLIST.has(host)) return true;
  if (host.includes(".") || host.includes("/")) return false;
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(host)) return false;
  return true;
}
