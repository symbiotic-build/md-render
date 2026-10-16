import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Runaway guard; tests should finish in seconds.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
