import { defineConfig } from 'vitest/config';

import { coverageThresholds } from './src/core/testing/coverage-gate';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['./tests/global-setup.ts'],
    include: ['tests/**/*.{spec,test,e2e-spec,story.test}.ts'],
    exclude: ['node_modules', 'dist', 'tests/k6/**', 'tests/types/**'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      // `json-summary` writes coverage-summary.json which the /dev/coverage
      // page reads to render the totals + per-file table.
      reporter: ['text', 'cobertura', 'html', 'json-summary'],
      reportsDirectory: 'reports/coverage',
      include: ['src/core/**', 'src/modules/**', 'src/shared/**'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.dto.ts',
        'src/**/index.ts',
        'src/main.ts',
        // NestJS module declarations + thin controllers are integration-
        // tested via e2e specs (real HTTP roundtrip). Excluding them
        // from the unit-coverage gate keeps the threshold focused on
        // pure-function logic where unit tests buy real safety.
        'src/**/*.module.ts',
        'src/**/*.controller.ts',
        'src/**/*.interceptor.ts',
        'src/**/*.middleware.ts',
        'src/**/*.guard.ts',
        // Dev/admin HTML renderers — pure presentation glue (lots of
        // conditional CSS branches that don't represent real logic).
        // Smoke-tested via story tests + visited live during dev.
        'src/core/dx/*-ui.ts',
        'src/core/dx/dashboard-ui.ts',
        // Dev-Portal SPA source. Browser-only React tree, bundled by
        // `bun run build:dev-portal` and exercised manually in
        // development. The shell renderer (dev-portal-shell.ts) stays
        // covered — it crosses the trust boundary (server → browser).
        'src/core/dx/clients/**',
        // Non-source artefacts that may live inside src/ but never
        // execute: directory placeholders, ignore lists, docs. v8 can
        // pick these up if they end up in the include glob — exclude
        // explicitly so the coverage report stays focused on real code.
        'src/**/.gitkeep',
        'src/**/.gitignore',
        'src/**/.prettierrc',
        'src/**/.prettierignore',
        'src/**/.eslintrc*',
        'src/**/.eslintignore',
        'src/**/.npmignore',
        'src/**/.npmrc',
        'src/**/.env',
        'src/**/.env.*',
        'src/**/CLAUDE.md',
        'src/**/README.md',
        'src/**/*.md',
        'src/**/*.json',
        'src/**/*.yml',
        'src/**/*.yaml',
        'src/**/*.toml',
        'src/**/*.lock',
      ],
      thresholds: coverageThresholds,
    },
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: {
      junit: 'reports/junit.xml',
    },
  },
  resolve: {
    alias: {
      '@core': '/src/core',
      '@modules': '/src/modules',
      '@shared': '/src/shared',
    },
  },
});
