import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Each test file gets its own in-memory database; run them one at a time to keep memory low.
    fileParallelism: false,
  },
});
