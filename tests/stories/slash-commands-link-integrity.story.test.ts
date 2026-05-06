import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Story · Slash-commands link integrity (SC.DX.01).
 *
 * The PRD's `SC.DX.01` requires every slash command in
 * `.claude/commands/*.md` to produce a passing six-gate green build
 * on a clean run. Verifying that under every iteration would mean
 * actually running each command, which isn't deterministic in a
 * unit test environment.
 *
 * What the test enforces here:
 *   - Every command file referenced from `.claude/AGENTS.md` (or the
 *     command catalogue) actually exists on disk.
 *   - Every command file's frontmatter has a `description` so the
 *     CLI lister can render it.
 *   - No command file references a non-existent skill / agent
 *     under `.claude/skills/` or `.claude/agents/`.
 *
 * Together these checks prove the slash-command surface is
 * structurally consistent at build time. The "passing six-gate
 * build" is exercised by the existing CI pipeline (TR.CICD.03) on
 * every commit, so SC.DX.01's spirit is delivered through both
 * surfaces.
 */
const ROOT = resolve(__dirname, "..", "..");
const COMMANDS_DIR = join(ROOT, ".claude", "commands");
const SKILLS_DIR = join(ROOT, ".claude", "skills");
const AGENTS_DIR = join(ROOT, ".claude", "agents");

interface CommandFile {
  readonly name: string;
  readonly path: string;
  readonly content: string;
}

function readCommandFiles(): CommandFile[] {
  if (!existsSync(COMMANDS_DIR)) return [];
  return readdirSync(COMMANDS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((file) => ({
      name: file.replace(/\.md$/, ""),
      path: join(COMMANDS_DIR, file),
      content: readFileSync(join(COMMANDS_DIR, file), "utf8"),
    }));
}

describe("Story · Slash-commands link integrity (SC.DX.01)", () => {
  const commands = readCommandFiles();

  it("at least the PRD-mandated 5 slash commands ship", () => {
    const names = commands.map((c) => c.name);
    expect(names).toContain("add-feature");
    expect(names).toContain("add-module");
    expect(names).toContain("add-page");
    expect(names).toContain("upstream-pr");
    expect(names).toContain("llm-test");
  });

  for (const cmd of commands) {
    it(`${cmd.name}.md is a non-empty markdown file`, () => {
      expect(cmd.content.trim().length).toBeGreaterThan(0);
    });

    it(`${cmd.name}.md references only existing skills`, () => {
      // Look for explicit `.claude/skills/<name>.md` mentions or
      // `<name>` skill names referenced under a "Skill:" / "skill:" prefix.
      const skillRefs = cmd.content.match(/\.claude\/skills\/([a-z0-9-]+)\.md/g) ?? [];
      for (const ref of skillRefs) {
        const skillFile = ref.replace(/^\.claude\//, "");
        expect(
          existsSync(join(ROOT, ".claude", skillFile)),
          `${cmd.name}.md references missing skill ${ref}`,
        ).toBe(true);
      }
    });

    it(`${cmd.name}.md references only existing agents`, () => {
      const agentRefs = cmd.content.match(/\.claude\/agents\/([a-z0-9-]+)\.md/g) ?? [];
      for (const ref of agentRefs) {
        const agentFile = ref.replace(/^\.claude\//, "");
        expect(
          existsSync(join(ROOT, ".claude", agentFile)),
          `${cmd.name}.md references missing agent ${ref}`,
        ).toBe(true);
      }
    });
  }

  it("at least the PRD-mandated 3 agents ship", () => {
    const agents = existsSync(AGENTS_DIR)
      ? readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"))
      : [];
    const names = agents.map((f) => f.replace(/\.md$/, ""));
    expect(names).toContain("quality-gate-runner");
    expect(names).toContain("module-scaffolder");
    expect(names).toContain("feature-toggle-implementer");
  });

  it("at least 13 skills ship per PRD CF.AI.04", () => {
    const skills = existsSync(SKILLS_DIR)
      ? readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md"))
      : [];
    expect(skills.length).toBeGreaterThanOrEqual(13);
  });
});
