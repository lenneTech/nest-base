import { describe, expect, it } from 'vitest';

import {
  planProjectRename,
  ProjectAlreadyRenamedError,
  type ProjectRenameInput,
} from '../../src/core/setup/project-rename.js';

/**
 * Story · `bun run rename <new-name>` planner.
 *
 * The template ships with two name shapes: the long npm-style name
 * (`nest-server-template` in `package.json` / `README.md`) and the
 * short slug (`nst` in `portless.yml` / `docker-compose.yml`). When a
 * consumer forks the template, both should collapse to a single new
 * name (Option B from the design discussion — same string everywhere).
 *
 * The planner is pure — given the four canonical files + a new name,
 * it returns the rewritten contents per file. The runner does the
 * file I/O. Two security/safety properties pinned here:
 *
 *   1. Idempotent — if the current name already matches the new name
 *      (or a prior rename completed), the planner throws so the runner
 *      can short-circuit instead of silently no-op.
 *   2. Surgical — every rewrite uses an anchored pattern; unrelated
 *      content (comments, other strings, formatting) is preserved
 *      byte-for-byte.
 */
describe('Story · project-rename planner', () => {
  function fixture(): ProjectRenameInput['files'] {
    return {
      'package.json': '{\n  "name": "nest-server-template",\n  "version": "0.0.0"\n}\n',
      'README.md': '# nest-server-template\n\nTemplate-fähiger NestJS-Server.\n',
      'portless.yml':
        'project: nst\n\nservices:\n' +
        '  api:\n    target: http://localhost:3000\n    public: api.nst.localhost\n' +
        '  mailpit:\n    target: http://localhost:8025\n    public: mail.nst.localhost\n',
      'docker-compose.yml':
        'name: nst\n\nservices:\n' +
        '  postgres:\n    container_name: nst-postgres\n' +
        '  rustfs:\n    container_name: nst-rustfs\n\n' +
        'networks:\n  default:\n    name: nst-dev\n',
    };
  }

  it('rewrites package.json `name` field', () => {
    const plan = planProjectRename({ files: fixture(), newName: 'my-app' });
    const after = plan.files.find((f) => f.path === 'package.json')!.after;
    expect(after).toContain('"name": "my-app"');
    expect(after).not.toContain('"name": "nest-server-template"');
    // Other JSON fields stay intact.
    expect(after).toContain('"version": "0.0.0"');
  });

  it('rewrites the first H1 in README.md', () => {
    const plan = planProjectRename({ files: fixture(), newName: 'my-app' });
    const after = plan.files.find((f) => f.path === 'README.md')!.after;
    expect(after.startsWith('# my-app\n')).toBe(true);
    expect(after).toContain('Template-fähiger NestJS-Server.');
  });

  it('rewrites portless project + every <slug>.localhost hostname', () => {
    const plan = planProjectRename({ files: fixture(), newName: 'my-app' });
    const after = plan.files.find((f) => f.path === 'portless.yml')!.after;
    expect(after).toMatch(/^project: my-app$/m);
    expect(after).toContain('api.my-app.localhost');
    expect(after).toContain('mail.my-app.localhost');
    expect(after).not.toContain('nst.localhost');
  });

  it('rewrites docker-compose top-level name + container_name prefixes + network name', () => {
    const plan = planProjectRename({ files: fixture(), newName: 'my-app' });
    const after = plan.files.find((f) => f.path === 'docker-compose.yml')!.after;
    expect(after).toMatch(/^name: my-app$/m);
    expect(after).toContain('container_name: my-app-postgres');
    expect(after).toContain('container_name: my-app-rustfs');
    expect(after).toContain('name: my-app-dev');
    expect(after).not.toContain('nst-postgres');
    expect(after).not.toContain('nst-rustfs');
    expect(after).not.toContain('nst-dev');
  });

  it('throws ProjectAlreadyRenamedError only when ALL canonical files already match', () => {
    // Both the long name (package.json/README) AND the slug
    // (portless/docker-compose) are already at newName — nothing to do.
    const fully: ProjectRenameInput['files'] = {
      'package.json': '{\n  "name": "my-app",\n  "version": "0.0.0"\n}\n',
      'README.md': '# my-app\n\nTemplate.\n',
      'portless.yml':
        'project: my-app\n\nservices:\n  api:\n    public: api.my-app.localhost\n',
      'docker-compose.yml':
        'name: my-app\n\nservices:\n  postgres:\n    container_name: my-app-postgres\n\n' +
        'networks:\n  default:\n    name: my-app-dev\n',
    };
    expect(() => planProjectRename({ files: fully, newName: 'my-app' })).toThrow(
      ProjectAlreadyRenamedError,
    );
  });

  it('does NOT throw when only package.json matches but the slug is still the old one', () => {
    // The original template ships in this state: `package.json` says
    // `nest-server-template` (long) but `portless.yml` says `nst`. A
    // user running `bun run rename nest-server-template` here must be
    // able to align portless+docker-compose without the idempotency
    // check short-circuiting.
    const partial = fixture();
    // Long name already matches, slug doesn't.
    expect(() => planProjectRename({ files: partial, newName: 'nest-server-template' })).not.toThrow();
    const plan = planProjectRename({ files: partial, newName: 'nest-server-template' });
    const compose = plan.files.find((f) => f.path === 'docker-compose.yml')!.after;
    expect(compose).toContain('container_name: nest-server-template-postgres');
    expect(compose).toContain('name: nest-server-template-dev');
    const portless = plan.files.find((f) => f.path === 'portless.yml')!.after;
    expect(portless).toMatch(/^project: nest-server-template$/m);
  });

  it('rejects an invalid kebab-name (would corrupt YAML / package.json)', () => {
    expect(() =>
      planProjectRename({ files: fixture(), newName: 'My App!' }),
    ).toThrow(/kebab-case/);
    expect(() =>
      planProjectRename({ files: fixture(), newName: '' }),
    ).toThrow(/kebab-case/);
  });

  it('handles a subsequent rename (current name read from package.json, slug derived from current state)', () => {
    // Imagine someone already ran `bun run rename my-app` once; now they
    // rename again to `my-other-app`. The planner must read the *current*
    // state — both the long name and the slug — and rewrite to the new.
    const renamed: ProjectRenameInput['files'] = {
      'package.json': '{\n  "name": "my-app",\n  "version": "0.0.0"\n}\n',
      'README.md': '# my-app\n\nTemplate-fähiger NestJS-Server.\n',
      'portless.yml':
        'project: my-app\n\nservices:\n  api:\n    public: api.my-app.localhost\n',
      'docker-compose.yml':
        'name: my-app\n\nservices:\n  postgres:\n    container_name: my-app-postgres\n\n' +
        'networks:\n  default:\n    name: my-app-dev\n',
    };
    const plan = planProjectRename({ files: renamed, newName: 'my-other-app' });
    const pkg = plan.files.find((f) => f.path === 'package.json')!.after;
    expect(pkg).toContain('"name": "my-other-app"');
    const compose = plan.files.find((f) => f.path === 'docker-compose.yml')!.after;
    expect(compose).toContain('container_name: my-other-app-postgres');
    expect(compose).toContain('name: my-other-app-dev');
  });

  it('preserves trailing newlines (POSIX file convention)', () => {
    const plan = planProjectRename({ files: fixture(), newName: 'my-app' });
    for (const f of plan.files) {
      expect(f.after.endsWith('\n'), `${f.path} must end with newline`).toBe(true);
    }
  });

  it('reports the old long + slug names so the runner can log a useful diff summary', () => {
    const plan = planProjectRename({ files: fixture(), newName: 'my-app' });
    expect(plan.oldLong).toBe('nest-server-template');
    expect(plan.oldSlug).toBe('nst');
  });
});
