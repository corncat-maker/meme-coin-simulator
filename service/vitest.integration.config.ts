import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['app/controller/*.test.ts'],
    setupFiles: ['./runtime/test/setup.ts'],
    fileParallelism: false,
    maxConcurrency: 1,
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['default', 'json'],
    outputFile: {
      json: '.service-integration-results/vitest-results.json',
    },
  },
});
