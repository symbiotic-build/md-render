import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Chromium uses several processes per file: five workers on 10 cores, two on 4.
    pool: 'forks',
    fileParallelism: true,
    maxWorkers: '50%',
    // Runaway guard; tests should finish in seconds.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
