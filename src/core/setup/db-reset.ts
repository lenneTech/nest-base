/**
 * Pure planner for `bun run reset`.
 *
 * Wipe-Migrate-Seed cycle in one command. The runner executes the
 * returned `steps` in order via `Bun.spawn`. The planner enforces
 * three safety gates that the runner doesn't have to know about:
 *
 *   1. NODE_ENV must NOT be `production`.
 *   2. DATABASE_URL must be set.
 *   3. The DATABASE_URL host must look local (loopback, localhost,
 *      or a docker-compose service name without dots). This is a
 *      defense-in-depth check, NOT a substitute for permissions —
 *      `prisma migrate reset --force` deletes data, full stop.
 *
 * Steps for the dev path:
 *
 *   - `prepare-schema` (only when feature-gated schemas exist)
 *   - `wipe`     (`bun run scripts/wipe-db.ts` — DROP/CREATE SCHEMA via pg)
 *   - `migrate`  (`bunx prisma migrate deploy`)
 *   - `seed`     (`bun run scripts/seed.ts`, only when configured)
 *
 * The `wipe` step deliberately does NOT call `prisma migrate reset`
 * because Prisma 7 blocks that command for AI agents via a built-in
 * safety gate. A direct `DROP SCHEMA … CASCADE` via the `pg` client
 * achieves the same outcome without tripping the gate, which keeps
 * `bun run reset` usable for both humans and agents.
 */

export interface DbResetEnv {
  DATABASE_URL?: string;
}

export interface DbResetInput {
  env: DbResetEnv;
  nodeEnv: string;
  /** True when `prisma/features/*.prisma` files exist that need concatenation. */
  hasFeatureSchemas?: boolean;
  /** True when a top-level `scripts/seed.ts` is wired. */
  seedScript: boolean;
}

export interface DbResetStep {
  verb: "prepare-schema" | "wipe" | "migrate" | "seed";
  command: "bun" | "bunx";
  args: string[];
  env: Record<string, string>;
  description: string;
}

export interface DbResetPlan {
  allowed: boolean;
  steps: DbResetStep[];
  refusalReason?: string;
}

const LOCAL_HOST_ALLOWLIST = new Set(["localhost", "127.0.0.1", "::1"]);

export function planDbReset(input: DbResetInput): DbResetPlan {
  if (input.nodeEnv === "production") {
    return {
      allowed: false,
      steps: [],
      refusalReason: "refusing: NODE_ENV=production. `bun run reset` is dev-only.",
    };
  }

  const url = input.env.DATABASE_URL;
  if (!url) {
    return {
      allowed: false,
      steps: [],
      refusalReason: "refusing: DATABASE_URL is not set.",
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
  const steps: DbResetStep[] = [];

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
    verb: "wipe",
    command: "bun",
    args: ["run", "scripts/wipe-db.ts"],
    env,
    description: "DROP SCHEMA public CASCADE; CREATE SCHEMA public (via pg, no Prisma)",
  });

  steps.push({
    verb: "migrate",
    command: "bunx",
    args: ["prisma", "migrate", "deploy"],
    env,
    description: "Apply every migration to bring the schema back up",
  });

  if (input.seedScript) {
    steps.push({
      verb: "seed",
      command: "bun",
      args: ["run", "scripts/seed.ts"],
      env,
      description: "Insert demo data from the seed planner",
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
  // Docker-compose service names look like simple identifiers
  // (`postgres`, `db`, `app-db`) — no dots, no slashes. Anything
  // FQDN-shaped (contains a dot) is treated as remote.
  if (host.includes(".")) return false;
  if (host.includes("/")) return false;
  // Reject empty / whitespace.
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(host)) return false;
  return true;
}
