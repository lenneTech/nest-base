import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..');

/**
 * Story · `.vscode/` defaults (PLAN.md §27 + §32 Phase 8).
 *
 * Four files seed an out-of-the-box VSCode/Cursor experience for
 * the template:
 *
 *   - extensions.json — recommended extensions; opens the prompt
 *     to install the lot when the workspace is first opened.
 *   - launch.json     — debug configs covering "Run dev server" and
 *     "Run current Vitest file" so a new contributor can step
 *     through code without rolling their own.
 *   - tasks.json      — the Bun-aware aliases for the gates the
 *     CI runs (lint, test, build, coverage).
 *   - settings.json   — workspace-level lint/format on save plus
 *     the editor settings that match the project (oxlint/oxfmt
 *     instead of ESLint/Prettier).
 *
 * The test pins the load-bearing entries each file must contain so
 * a future cleanup can't silently drop them.
 */
describe('Story · .vscode/ defaults', () => {
  function readJson(relPath: string): unknown {
    const full = resolve(ROOT, relPath);
    expect(existsSync(full), `${relPath} must exist`).toBe(true);
    // Strip line + block comments (jsonc) before parsing.
    const raw = readFileSync(full, 'utf8')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    return JSON.parse(raw) as unknown;
  }

  describe('extensions.json', () => {
    const file = '.vscode/extensions.json';

    it('exists and parses as JSON-with-comments', () => {
      const data = readJson(file) as { recommendations?: string[] };
      expect(Array.isArray(data.recommendations)).toBe(true);
    });

    it('recommends oxlint + oxfmt + Prisma + Vitest extensions', () => {
      const data = readJson(file) as { recommendations: string[] };
      expect(data.recommendations).toContain('oxc.oxc-vscode');
      expect(data.recommendations).toContain('Prisma.prisma');
      expect(data.recommendations).toContain('vitest.explorer');
    });
  });

  describe('launch.json', () => {
    const file = '.vscode/launch.json';

    it('exists and declares two configurations', () => {
      const data = readJson(file) as { configurations?: Array<Record<string, unknown>> };
      expect(Array.isArray(data.configurations)).toBe(true);
      expect(data.configurations!.length).toBeGreaterThanOrEqual(2);
    });

    it('includes a "Run dev server" config that runs `bun run dev`', () => {
      const data = readJson(file) as { configurations: Array<Record<string, unknown>> };
      const dev = data.configurations.find((c) => /dev server/i.test(String(c.name)));
      expect(dev, 'dev-server config must exist').toBeDefined();
      expect(String(dev!.runtimeExecutable ?? dev!.command ?? '')).toMatch(/bun/);
    });

    it('includes a "Run current Vitest file" config', () => {
      const data = readJson(file) as { configurations: Array<Record<string, unknown>> };
      const vitest = data.configurations.find((c) => /vitest/i.test(String(c.name)));
      expect(vitest, 'vitest config must exist').toBeDefined();
    });
  });

  describe('tasks.json', () => {
    const file = '.vscode/tasks.json';

    it('exposes the four CI-gate aliases', () => {
      const data = readJson(file) as { tasks?: Array<{ label?: string }> };
      const labels = (data.tasks ?? []).map((t) => t.label);
      expect(labels).toContain('Lint');
      expect(labels).toContain('Test');
      expect(labels).toContain('Build');
      expect(labels).toContain('Coverage');
    });

    it('routes every task through bun (no node/npm shells)', () => {
      const data = readJson(file) as { tasks: Array<Record<string, unknown>> };
      for (const task of data.tasks) {
        const cmd = String(task.command ?? '') + ' ' + String((task.args as string[] | undefined)?.join(' ') ?? '');
        expect(cmd, `task "${task.label}" should run via bun`).toMatch(/bun/);
      }
    });
  });

  describe('settings.json', () => {
    const file = '.vscode/settings.json';

    it('uses oxc as the JS/TS formatter (not Prettier)', () => {
      const data = readJson(file) as Record<string, unknown>;
      expect(data['editor.defaultFormatter']).toBe('oxc.oxc-vscode');
    });

    it('enables format-on-save', () => {
      const data = readJson(file) as Record<string, unknown>;
      expect(data['editor.formatOnSave']).toBe(true);
    });

    it('disables ESLint and Prettier extensions explicitly (we use oxc instead)', () => {
      const data = readJson(file) as Record<string, unknown>;
      expect(data['eslint.enable']).toBe(false);
      expect(data['prettier.enable']).toBe(false);
    });
  });
});
