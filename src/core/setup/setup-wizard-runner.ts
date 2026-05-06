import { spawnSync } from "node:child_process";
import { randomBytes as nodeRandomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { computeComposeProjectName } from "./compose-project-name.js";
import { planFrontendEnvBridge } from "./frontend-env-bridge.js";
import { buildDefaultEnvExample } from "./setup-wizard.js";

/**
 * Setup-wizard runner planner.
 *
 * Pure function: takes the `.env.example` text + an injectable RNG,
 * returns the rendered `.env` text with every recognised template
 * value replaced by a fresh secret. `runSetupWizard()` is the thin
 * I/O wrapper invoked by `scripts/setup-wizard.ts`.
 *
 * Three properties locked in:
 *   - Recognised template values (BETTER_AUTH_SECRET, POSTGRES_PASSWORD,
 *     POWERSYNC_DB_PASSWORD, FIELD_ENCRYPTION_KEK, S3_SECRET_KEY) get
 *     freshly random values — never the example template value.
 *   - DATABASE_URL is rewritten to use the freshly generated
 *     POSTGRES_PASSWORD so the URL stays in sync with the DSN parts.
 *   - Unknown lines (comments, blank lines, custom vars added by the
 *     project) pass through untouched. Future contributors can add new
 *     env vars without the runner silently dropping them.
 */

export type RandomBytesFn = (size: number) => Buffer;

export interface PlanEnvFromExampleOptions {
  randomBytes: RandomBytesFn;
  /**
   * When provided, project-scoped vars get tailored to this name:
   * `POSTGRES_USER`/`POSTGRES_DB`/`DATABASE_URL` switch from the
   * template's name to this one, and `APP_BASE_URL` becomes the
   * portless host (`https://api.<name>.localhost`).
   */
  projectName?: string;
  /**
   * Override `POSTGRES_HOST_PORT` (and the port inside `DATABASE_URL`)
   * when present. Runner picks a free port via `findFreePort()`; pass
   * undefined to leave whatever the example already had.
   */
  postgresHostPort?: number;
  /**
   * Override the `COMPOSE_PROJECT_NAME` line. The runner derives this
   * from `computeComposeProjectName({ projectName, workspacePath })`
   * so two workspaces with the same name in different dirs get
   * different docker volumes (friction-log entry 14:21). When omitted,
   * the line passes through with whatever the project-name rewrite
   * produced.
   */
  composeProjectName?: string;
}

const TEMPLATE_NAME = "nest-base";

interface SecretSpec {
  /** Bytes of entropy to draw. */
  bytes: number;
  /** Output encoding for the secret value. */
  encoding: "base64url" | "base64" | "hex";
}

const SECRET_VARS: Record<string, SecretSpec> = {
  BETTER_AUTH_SECRET: { bytes: 32, encoding: "base64url" },
  POSTGRES_PASSWORD: { bytes: 24, encoding: "base64url" },
  POWERSYNC_DB_PASSWORD: { bytes: 24, encoding: "base64url" },
  FIELD_ENCRYPTION_KEK: { bytes: 32, encoding: "base64" },
  S3_SECRET_KEY: { bytes: 24, encoding: "base64url" },
  // SystemSetupConfigSchema requires ≥ 12 chars; 16 bytes base64url ≈ 22
  // chars, comfortably above the floor and 128 bits of entropy.
  SYSTEM_SETUP_ADMIN_PASSWORD: { bytes: 16, encoding: "base64url" },
};

export function planEnvFromExample(
  exampleText: string,
  options: PlanEnvFromExampleOptions,
): string {
  // Apply project-name substitution to the *template* text first so it
  // never touches generated secrets. Only kicks in when the project has
  // been renamed away from the template default.
  const projectName = options.projectName;
  const tailorProject = projectName !== undefined && projectName !== TEMPLATE_NAME;
  let sourceText = tailorProject
    ? rewriteProjectScopedVars(exampleText, projectName!)
    : exampleText;

  // Override POSTGRES_HOST_PORT + the port baked into DATABASE_URL.
  // Default-generated `.env.example` ships `5432`; the runner shifts to
  // a free port at setup time so two `--next` workspaces on the same
  // host don't collide.
  if (options.postgresHostPort !== undefined && options.postgresHostPort !== 5432) {
    sourceText = rewritePostgresHostPort(sourceText, options.postgresHostPort);
  }

  // Override COMPOSE_PROJECT_NAME with the per-workspace hashed value.
  // Without this, two workspaces named the same in different paths
  // share `<name>_postgres_data` and inherit each other's POSTGRES_PASSWORD
  // on first boot (friction-log entry 14:21).
  if (options.composeProjectName !== undefined) {
    sourceText = rewriteComposeProjectName(sourceText, options.composeProjectName);
  }

  const generated: Record<string, string> = {};
  const lines = sourceText.split("\n");
  const out: string[] = [];

  for (const line of lines) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) {
      out.push(line);
      continue;
    }
    const [, key, value] = match;
    const spec = SECRET_VARS[key!];
    if (spec) {
      const secret = encodeBytes(options.randomBytes(spec.bytes), spec.encoding);
      generated[key!] = secret;
      out.push(`${key}=${secret}`);
      continue;
    }
    if (key === "DATABASE_URL" && generated.POSTGRES_PASSWORD && value) {
      // Replace the example POSTGRES_PASSWORD inside the URL with the
      // freshly generated one. Other parts (user, host, port, db) are
      // left intact so the operator's own choices survive.
      const rewritten = value!.replace(/change-me-strong-pass/g, generated.POSTGRES_PASSWORD);
      out.push(`${key}=${rewritten}`);
      continue;
    }
    out.push(line);
  }

  const joined = out.join("\n");
  return joined.endsWith("\n") ? joined : joined + "\n";
}

/**
 * Rewrite the template-name token + the localhost APP_BASE_URL to
 * project-specific values. Operates on raw text so it stays transparent
 * to the secret-substitution loop above.
 */
/**
 * Swap the host-port number used by Postgres in `.env.example`. Only
 * touches the two lines that reference the default 5432: the
 * `POSTGRES_HOST_PORT` declaration and the `DATABASE_URL` connection
 * string. Everything else passes through untouched so we never
 * accidentally rewrite a port number that happens to also be 5432
 * (e.g. inside an unrelated comment).
 */
function rewritePostgresHostPort(text: string, port: number): string {
  return text
    .replace(/^POSTGRES_HOST_PORT=\d+$/m, `POSTGRES_HOST_PORT=${port}`)
    .replace(/^(DATABASE_URL=postgresql:\/\/[^@]+@localhost):\d+(\/[^\n]+)$/m, `$1:${port}$2`);
}

/**
 * Replace the `COMPOSE_PROJECT_NAME=<value>` line with the per-workspace
 * hashed name. Anchored on `^COMPOSE_PROJECT_NAME=` so only that one
 * line gets rewritten — comments referring to the variable name pass
 * through untouched.
 */
function rewriteComposeProjectName(text: string, name: string): string {
  return text.replace(/^COMPOSE_PROJECT_NAME=.*$/m, `COMPOSE_PROJECT_NAME=${name}`);
}

function rewriteProjectScopedVars(text: string, projectName: string): string {
  // Replace every occurrence of the template name. POSTGRES_USER /
  // POSTGRES_DB / DATABASE_URL all carry it; nothing else in
  // .env.example does (comments don't, secrets don't).
  let out = text.split(TEMPLATE_NAME).join(projectName);
  // APP_BASE_URL: assume portless when a name is given. Local-only devs
  // edit this back to http://localhost:<port> after generation.
  out = out.replace(
    /^APP_BASE_URL=http:\/\/localhost:\d+$/m,
    `APP_BASE_URL=https://api.${projectName}.localhost`,
  );
  return out;
}

function encodeBytes(buf: Buffer, encoding: SecretSpec["encoding"]): string {
  if (encoding === "base64") return buf.toString("base64");
  if (encoding === "hex") return buf.toString("hex");
  // base64url — Node's Buffer accepts the encoding directly.
  return buf.toString("base64url");
}

export interface SetupWizardLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface RunSetupWizardOptions {
  projectRoot: string;
  /** Override the RNG (tests). Defaults to `crypto.randomBytes`. */
  randomBytes?: RandomBytesFn;
  logger?: SetupWizardLogger;
  /**
   * Postgres host-port to bake into the generated `.env`. Pass the
   * result of `findFreePort(5432)` from the runner script. Falls back
   * to the example default (5432) when omitted, which is fine for
   * tests but collides between two `--next` workspaces in real life.
   */
  postgresHostPort?: number;
  /**
   * Override the dev-portal build invocation (tests). Defaults to
   * `bun run scripts/build-dev-portal.ts` so the SPA bundle is in place
   * before the first `bun run dev`. Pass `() => 0` in tests to skip.
   */
  buildDevPortal?: (cwd: string) => number;
}

export interface SetupWizardResult {
  /** Absolute path of the `.env` file (whether created or pre-existing). */
  envPath: string;
  /** True when this run wrote `.env`; false when it was already present. */
  created: boolean;
  /** Exit code returned by the dev-portal bundler. `null` when not run. */
  devPortalBuildExit: number | null;
}

const SILENT_LOGGER: SetupWizardLogger = { info: () => {}, warn: () => {} };

function readPackageJsonName(root: string): string | undefined {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  const match = /"name"\s*:\s*"([^"]+)"/.exec(readFileSync(pkgPath, "utf8"));
  return match?.[1];
}

export function runSetupWizard(options: RunSetupWizardOptions): SetupWizardResult {
  const logger = options.logger ?? SILENT_LOGGER;
  const examplePath = join(options.projectRoot, ".env.example");
  const envPath = join(options.projectRoot, ".env");

  if (!existsSync(examplePath)) {
    logger.info(`generating ${examplePath} from buildDefaultEnvExample()`);
    writeFileSync(examplePath, buildDefaultEnvExample(), "utf8");
  }

  let created = false;
  const projectName = readPackageJsonName(options.projectRoot);
  if (existsSync(envPath)) {
    logger.warn(
      `${envPath} already exists — refusing to overwrite (delete it first to regenerate)`,
    );
  } else {
    const exampleText = readFileSync(examplePath, "utf8");
    // Derive the per-workspace hashed `COMPOSE_PROJECT_NAME` so two
    // workspaces with the same project name in different paths never
    // collide on the same docker volume. Only baked into freshly
    // written `.env`s — pre-existing files are preserved unchanged
    // by the `existsSync` short-circuit above.
    const composeProjectName = projectName
      ? computeComposeProjectName({
          projectName,
          workspacePath: options.projectRoot,
        })
      : undefined;
    const rendered = planEnvFromExample(exampleText, {
      randomBytes: options.randomBytes ?? ((size) => nodeRandomBytes(size)),
      projectName,
      postgresHostPort: options.postgresHostPort,
      composeProjectName,
    });
    writeFileSync(envPath, rendered, "utf8");
    logger.info(`wrote ${envPath} with auto-generated secrets`);
    created = true;
  }

  // Frontend env-bridge (friction-log #5): mirror the chosen API port
  // and portless URL into `projects/app/.env` so the upstream Nuxt
  // starter follows the API automatically. Skipped silently when
  // `projects/app/` doesn't exist (api-only workspaces). Custom user
  // values are preserved — only the wizard-default sentinel is updated.
  if (projectName) {
    writeFrontendEnvBridge({
      projectRoot: options.projectRoot,
      projectName,
      apiPort: deriveApiPort(envPath),
      logger,
    });
  }

  // Build the Dev-Portal SPA once so `/hub/static/main.js` exists from
  // the very first `bun run dev`. Skipped silently when the entry file
  // is absent (some downstream projects may strip the dev surface).
  let devPortalBuildExit: number | null = null;
  const portalEntry = join(options.projectRoot, "src/core/dx/clients/main.tsx");
  const buildPortalScript = join(options.projectRoot, "scripts/build-dev-portal.ts");
  if (existsSync(portalEntry) && existsSync(buildPortalScript)) {
    const builder =
      options.buildDevPortal ??
      ((cwd: string) =>
        spawnSync("bun", ["run", "scripts/build-dev-portal.ts"], {
          cwd,
          stdio: "inherit",
        }).status ?? 1);
    devPortalBuildExit = builder(options.projectRoot);
    if (devPortalBuildExit === 0) {
      logger.info("built dev-portal bundle (dist/dev-portal/main.js)");
    } else {
      logger.warn(
        `dev-portal build returned exit code ${devPortalBuildExit} — run \`bun run build:dev-portal\` manually`,
      );
    }
  }

  return { envPath, created, devPortalBuildExit };
}

interface WriteFrontendEnvBridgeOptions {
  projectRoot: string;
  projectName: string;
  apiPort: number;
  logger: SetupWizardLogger;
}

/**
 * Thin runner around `planFrontendEnvBridge`. Reads the existing
 * `projects/app/.env` (if any), feeds it to the planner, writes the
 * result. The planner alone owns the merge logic; this function is
 * just I/O.
 */
function writeFrontendEnvBridge(options: WriteFrontendEnvBridgeOptions): void {
  const appDir = join(options.projectRoot, "projects/app");
  const appExists = existsSync(appDir) && safeIsDirectory(appDir);
  const frontendEnvPath = join(appDir, ".env");
  const currentEnv =
    appExists && existsSync(frontendEnvPath) ? readFileSync(frontendEnvPath, "utf8") : undefined;

  const plan = planFrontendEnvBridge({
    projectName: options.projectName,
    apiPort: options.apiPort,
    appExists,
    currentEnv,
  });

  if (plan.action === "skip") return;

  writeFileSync(frontendEnvPath, plan.next, "utf8");
  options.logger.info(
    `wrote frontend env-bridge to ${frontendEnvPath} (NUXT_PUBLIC_API_URL=https://api.${options.projectName}.localhost)`,
  );
}

function safeIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Pull the API port out of the freshly written `.env`. Falls back to
 * 3000 (the wizard default) when the file is missing or doesn't carry
 * an explicit `PORT=`. Used to populate `API_PORT` in the frontend
 * env-bridge so consumers without portless can dial the right port
 * directly.
 */
function deriveApiPort(envPath: string): number {
  if (!existsSync(envPath)) return 3000;
  const text = readFileSync(envPath, "utf8");
  const match = /^PORT=(\d+)$/m.exec(text);
  if (!match) return 3000;
  const n = Number(match[1]);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : 3000;
}
