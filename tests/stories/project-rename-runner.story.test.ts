import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  runProjectRename,
  type ProjectRenameLogger,
} from '../../src/core/setup/project-rename-runner.js';

/**
 * Story · `bun run rename` runner I/O.
 *
 * The runner is the thin file-system wrapper around the pure planner.
 * It reads the four canonical files from the project root, calls
 * `planProjectRename`, and writes the rewritten contents back. Tests
 * pin the I/O contract end-to-end.
 */
describe('Story · bun run rename runner I/O', () => {
  let workspace: string;
  let logs: string[];
  const logger: ProjectRenameLogger = {
    info: (msg) => logs.push(`INFO ${msg}`),
    warn: (msg) => logs.push(`WARN ${msg}`),
  };

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'rename-'));
    logs = [];
    seedFixture(workspace);
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  function seedFixture(root: string): void {
    writeFileSync(
      join(root, 'package.json'),
      '{\n  "name": "nest-server-template",\n  "version": "0.0.0"\n}\n',
    );
    writeFileSync(
      join(root, 'README.md'),
      '# nest-server-template\n\nTemplate-fähiger NestJS-Server.\n',
    );
    writeFileSync(
      join(root, 'portless.yml'),
      'project: nst\n\nservices:\n  api:\n    public: api.nst.localhost\n',
    );
    writeFileSync(
      join(root, 'docker-compose.yml'),
      'name: nst\n\nservices:\n  postgres:\n    container_name: nst-postgres\n\nnetworks:\n  default:\n    name: nst-dev\n',
    );
  }

  it('rewrites all four canonical files', () => {
    const result = runProjectRename({ projectRoot: workspace, newName: 'my-app', logger });
    expect(result.changed).toBe(true);

    expect(readFileSync(join(workspace, 'package.json'), 'utf8')).toContain('"name": "my-app"');
    expect(readFileSync(join(workspace, 'README.md'), 'utf8').startsWith('# my-app\n')).toBe(true);
    expect(readFileSync(join(workspace, 'portless.yml'), 'utf8')).toContain('project: my-app');
    expect(readFileSync(join(workspace, 'portless.yml'), 'utf8')).toContain('api.my-app.localhost');
    expect(readFileSync(join(workspace, 'docker-compose.yml'), 'utf8')).toContain('container_name: my-app-postgres');
    expect(readFileSync(join(workspace, 'docker-compose.yml'), 'utf8')).toContain('name: my-app-dev');
  });

  it('returns the previous names for the runner banner', () => {
    const result = runProjectRename({ projectRoot: workspace, newName: 'my-app', logger });
    expect(result.oldLong).toBe('nest-server-template');
    expect(result.oldSlug).toBe('nst');
  });

  it('is a no-op when the project name already matches (idempotent)', () => {
    runProjectRename({ projectRoot: workspace, newName: 'my-app', logger });
    logs.length = 0;
    const second = runProjectRename({ projectRoot: workspace, newName: 'my-app', logger });
    expect(second.changed).toBe(false);
    expect(logs.some((l) => /already named/.test(l))).toBe(true);
  });

  it('refuses when one of the canonical files is missing', () => {
    rmSync(join(workspace, 'portless.yml'));
    expect(() => runProjectRename({ projectRoot: workspace, newName: 'my-app', logger })).toThrow(
      /portless\.yml/,
    );
  });

  it('refuses when newName is not kebab-case (planner contract)', () => {
    expect(() =>
      runProjectRename({ projectRoot: workspace, newName: 'My App', logger }),
    ).toThrow(/kebab-case/);
  });

  it('the rename is end-to-end stable: a second rename to a third name still succeeds', () => {
    runProjectRename({ projectRoot: workspace, newName: 'my-app', logger });
    runProjectRename({ projectRoot: workspace, newName: 'my-other-app', logger });
    expect(readFileSync(join(workspace, 'package.json'), 'utf8')).toContain('"name": "my-other-app"');
    expect(readFileSync(join(workspace, 'docker-compose.yml'), 'utf8')).toContain(
      'container_name: my-other-app-postgres',
    );
  });
});
