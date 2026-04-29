/**
 * `bun run rename <new-name>` planner.
 *
 * The template ships with two name shapes — the long npm-style name
 * (`package.json`, README) and a short slug (portless project,
 * docker-compose top-level + container_name prefixes + network name).
 * On rename, both collapse to a single new name. This module is the
 * pure planner; the runner in `scripts/rename-project.ts` handles I/O.
 *
 * Renames are *surgical*: each file is rewritten via a single anchored
 * pattern that targets exactly the place where the old name lives.
 * Comments, formatting, and unrelated content survive byte-for-byte.
 */

const KEBAB_NAME = /^[a-z][a-z0-9-]*[a-z0-9]$/;

const RENAMED_FILE_PATHS = [
  "package.json",
  "README.md",
  "portless.yml",
  "docker-compose.yml",
] as const;
export type RenamedFilePath = (typeof RENAMED_FILE_PATHS)[number];

export interface ProjectRenameInput {
  files: Record<RenamedFilePath, string>;
  newName: string;
}

export interface RenamedFile {
  path: RenamedFilePath;
  before: string;
  after: string;
}

export interface ProjectRenamePlan {
  files: RenamedFile[];
  oldLong: string;
  oldSlug: string;
}

export class ProjectAlreadyRenamedError extends Error {
  constructor(currentName: string) {
    super(`project-rename: package.json name is already "${currentName}" — nothing to do`);
    this.name = "ProjectAlreadyRenamedError";
  }
}

export function planProjectRename(input: ProjectRenameInput): ProjectRenamePlan {
  const { files, newName } = input;
  if (!KEBAB_NAME.test(newName)) {
    throw new Error(
      `project-rename: "${newName}" is not a valid kebab-case package name (expected /^[a-z][a-z0-9-]*[a-z0-9]$/)`,
    );
  }

  const oldLong = readJsonName(files["package.json"]);
  const oldSlug = readPortlessProject(files["portless.yml"]);

  // Only short-circuit when every canonical file is already at the new
  // name. A partial state (e.g. package.json long-renamed but portless
  // slug still old) must proceed so the rewrite can align the rest.
  if (oldLong === newName && oldSlug === newName) {
    throw new ProjectAlreadyRenamedError(oldLong);
  }

  return {
    oldLong,
    oldSlug,
    files: [
      {
        path: "package.json",
        before: files["package.json"],
        after: rewritePackageJson(files["package.json"], oldLong, newName),
      },
      {
        path: "README.md",
        before: files["README.md"],
        after: rewriteReadme(files["README.md"], oldLong, newName),
      },
      {
        path: "portless.yml",
        before: files["portless.yml"],
        after: rewritePortless(files["portless.yml"], oldSlug, newName),
      },
      {
        path: "docker-compose.yml",
        before: files["docker-compose.yml"],
        after: rewriteCompose(files["docker-compose.yml"], oldSlug, newName),
      },
    ],
  };
}

function readJsonName(text: string): string {
  const match = /"name"\s*:\s*"([^"]+)"/.exec(text);
  if (!match) throw new Error('project-rename: package.json must contain a "name" field');
  return match[1]!;
}

function readPortlessProject(text: string): string {
  const match = /^project:\s*([a-z][a-z0-9-]*)$/m.exec(text);
  if (!match)
    throw new Error("project-rename: portless.yml must contain a top-level `project:` key");
  return match[1]!;
}

function rewritePackageJson(text: string, oldLong: string, newName: string): string {
  // Anchored on the JSON `"name": "<old>"` pattern. Other fields named
  // "name" deeper in the tree (none today) would also get hit if their
  // value matched oldLong — acceptable risk for surgical rename.
  return text.replace(
    new RegExp(`"name"\\s*:\\s*"${escapeRegex(oldLong)}"`),
    `"name": "${newName}"`,
  );
}

function rewriteReadme(text: string, oldLong: string, newName: string): string {
  // Replace the first H1 only — sub-headers and inline references are
  // left intact so descriptive prose ("the nest-server-template ships
  // with…") doesn't get mangled.
  return text.replace(new RegExp(`^#\\s+${escapeRegex(oldLong)}\\b`, "m"), `# ${newName}`);
}

function rewritePortless(text: string, oldSlug: string, newName: string): string {
  let out = text.replace(
    new RegExp(`^project:\\s*${escapeRegex(oldSlug)}$`, "m"),
    `project: ${newName}`,
  );
  // `<host>.<oldSlug>.localhost` → `<host>.<newName>.localhost`. Bound
  // by leading `.` so unrelated occurrences of the slug aren't touched.
  out = out.replace(
    new RegExp(`\\.${escapeRegex(oldSlug)}\\.localhost`, "g"),
    `.${newName}.localhost`,
  );
  return out;
}

function rewriteCompose(text: string, oldSlug: string, newName: string): string {
  let out = text.replace(new RegExp(`^name:\\s*${escapeRegex(oldSlug)}$`, "m"), `name: ${newName}`);
  // `container_name: <oldSlug>-<rest>` → `<newName>-<rest>`.
  out = out.replace(
    new RegExp(`(container_name:\\s*)${escapeRegex(oldSlug)}-`, "g"),
    `$1${newName}-`,
  );
  // Network: `name: <oldSlug>-dev` (the `-dev` suffix anchors it apart
  // from the top-level `name:` so we don't double-match).
  out = out.replace(
    new RegExp(`(^\\s+name:\\s*)${escapeRegex(oldSlug)}-dev$`, "m"),
    `$1${newName}-dev`,
  );
  return out;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
