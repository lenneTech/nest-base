import { randomBytes as nodeRandomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildDefaultEnvExample } from "./setup-wizard.js";

/**
 * Setup-wizard runner planner (PLAN.md §19.5 + Phase 7 follow-up).
 *
 * Pure function: takes the `.env.example` text + an injectable RNG,
 * returns the rendered `.env` text with every recognised placeholder
 * replaced by a fresh secret. `runSetupWizard()` is the thin I/O
 * wrapper invoked by `scripts/setup-wizard.ts`.
 *
 * Three properties locked in:
 *   - Recognised placeholders (BETTER_AUTH_SECRET, POSTGRES_PASSWORD,
 *     POWERSYNC_DB_PASSWORD, FIELD_ENCRYPTION_KEK, S3_SECRET_KEY) get
 *     freshly random values — never the example placeholder.
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
}

const TEMPLATE_NAME = "nest-server-template";

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
  // Apply project-name substitution to the *placeholder* text first so it
  // never touches generated secrets. Only kicks in when the project has
  // been renamed away from the template default.
  const projectName = options.projectName;
  const tailorProject = projectName !== undefined && projectName !== TEMPLATE_NAME;
  const sourceText = tailorProject
    ? rewriteProjectScopedVars(exampleText, projectName!)
    : exampleText;

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
 * Rewrite the placeholder template name + the localhost APP_BASE_URL to
 * project-specific values. Operates on raw text so it stays transparent
 * to the secret-substitution loop above.
 */
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
}

export interface SetupWizardResult {
  /** Absolute path of the `.env` file (whether created or pre-existing). */
  envPath: string;
  /** True when this run wrote `.env`; false when it was already present. */
  created: boolean;
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

  if (existsSync(envPath)) {
    logger.warn(
      `${envPath} already exists — refusing to overwrite (delete it first to regenerate)`,
    );
    return { envPath, created: false };
  }

  const exampleText = readFileSync(examplePath, "utf8");
  const projectName = readPackageJsonName(options.projectRoot);
  const rendered = planEnvFromExample(exampleText, {
    randomBytes: options.randomBytes ?? ((size) => nodeRandomBytes(size)),
    projectName,
  });
  writeFileSync(envPath, rendered, "utf8");
  logger.info(`wrote ${envPath} with auto-generated secrets`);
  return { envPath, created: true };
}
