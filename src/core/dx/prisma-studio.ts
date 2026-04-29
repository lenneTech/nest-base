/**
 * Prisma-Studio launcher planner.
 *
 * Pure function: env + flags → either a spawn plan to start
 * `prisma studio` in the background, or a `skip` reason. The runner
 * in `bootstrap.ts` calls `spawn(...)` with the resulting command,
 * detaches the process, and pipes its stderr to a black hole so a
 * port collision does not bleed into the API logs.
 *
 * Prisma 7 driver-adapter mode keeps the connection URL out of
 * `schema.prisma`, so `prisma studio` cannot discover it from the
 * config file alone — the URL is forwarded as `--url` and the schema
 * path comes from `prisma.config.ts`.
 *
 * Skip rules:
 *   - any non-development env
 *   - `PRISMA_STUDIO=0` set
 *   - `CI=true` set
 *   - no databaseUrl provided
 */

export interface PrismaStudioInput {
  env: "development" | "production" | "test" | "staging";
  /** Port the studio should bind to. Default 5555 (Prisma's own default). */
  port?: number;
  /**
   * Custom Prisma config path. Defaults to Prisma's own discovery
   * (`prisma.config.ts` in CWD). When set, forwarded as `--config`.
   */
  configPath?: string;
  /**
   * Explicit Postgres URL forwarded as `--url`. Required because Prisma 7
   * driver-adapter mode keeps the URL out of `schema.prisma`, so `prisma
   * studio` cannot otherwise discover it. When absent the planner skips.
   */
  databaseUrl?: string;
  env_vars?: {
    CI?: string;
    PRISMA_STUDIO?: string;
  };
}

export type PrismaStudioPlan =
  | {
      action: "spawn";
      command: string;
      args: string[];
      port: number;
      url: string;
    }
  | { action: "skip"; reason: string };

const DEFAULT_PORT = 5555;

export function planPrismaStudio(input: PrismaStudioInput): PrismaStudioPlan {
  if (input.env !== "development") {
    return { action: "skip", reason: `env is ${input.env}, not development` };
  }
  const vars = input.env_vars ?? {};
  if (vars.PRISMA_STUDIO === "0") {
    return { action: "skip", reason: "PRISMA_STUDIO=0 set" };
  }
  if (vars.CI && vars.CI !== "" && vars.CI !== "false" && vars.CI !== "0") {
    return { action: "skip", reason: "CI environment detected" };
  }

  if (!input.databaseUrl) {
    return { action: "skip", reason: "databaseUrl is empty (DATABASE_URL not set)" };
  }

  const port = input.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`prisma-studio: port must be in [1, 65535], got ${port}`);
  }

  const args = [
    "prisma",
    "studio",
    "--port",
    String(port),
    "--url",
    input.databaseUrl,
    "--browser",
    "none",
  ];
  if (input.configPath) {
    args.push("--config", input.configPath);
  }

  return {
    action: "spawn",
    command: "bunx",
    args,
    port,
    url: `http://localhost:${port}`,
  };
}
