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
      reporter: ['text', 'cobertura', 'html'],
      reportsDirectory: 'reports/coverage',
      include: ['src/core/**', 'src/modules/**', 'src/shared/**'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.dto.ts',
        'src/**/index.ts',
        'src/main.ts',
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
