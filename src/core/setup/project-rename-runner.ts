import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  planProjectRename,
  ProjectAlreadyRenamedError,
  type ProjectRenameInput,
  type RenamedFilePath,
} from "./project-rename.js";

/**
 * `bun run rename <new-name>` — thin I/O wrapper around the planner.
 *
 * Reads the four canonical files from `projectRoot`, runs the planner,
 * writes the rewritten contents back. Idempotent: if the planner
 * detects that the project is already named `newName`, the runner
 * short-circuits and returns `{ changed: false }`.
 */

export interface ProjectRenameLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface RunProjectRenameOptions {
  projectRoot: string;
  newName: string;
  logger?: ProjectRenameLogger;
}

export interface RunProjectRenameResult {
  changed: boolean;
  oldLong?: string;
  oldSlug?: string;
}

const SILENT_LOGGER: ProjectRenameLogger = { info: () => {}, warn: () => {} };

const CANONICAL_FILES: RenamedFilePath[] = [
  "package.json",
  "README.md",
  "portless.yml",
  "docker-compose.yml",
];

export function runProjectRename(options: RunProjectRenameOptions): RunProjectRenameResult {
  const logger = options.logger ?? SILENT_LOGGER;

  const files = {} as ProjectRenameInput["files"];
  for (const path of CANONICAL_FILES) {
    const absolute = join(options.projectRoot, path);
    if (!existsSync(absolute)) {
      throw new Error(`project-rename: required file ${path} not found at ${options.projectRoot}`);
    }
    files[path] = readFileSync(absolute, "utf8");
  }

  let plan;
  try {
    plan = planProjectRename({ files, newName: options.newName });
  } catch (err) {
    if (err instanceof ProjectAlreadyRenamedError) {
      logger.warn(`project is already named "${options.newName}" — skipping rename`);
      return { changed: false };
    }
    throw err;
  }

  for (const file of plan.files) {
    if (file.before === file.after) continue;
    writeFileSync(join(options.projectRoot, file.path), file.after, "utf8");
    logger.info(`updated ${file.path}`);
  }

  logger.info(`renamed "${plan.oldLong}" / "${plan.oldSlug}" → "${options.newName}"`);
  return { changed: true, oldLong: plan.oldLong, oldSlug: plan.oldSlug };
}
