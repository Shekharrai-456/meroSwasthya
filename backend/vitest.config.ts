import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts'],
    },
    // Real Postgres per CLAUDE.md §10 means tests share one server; run
    // sequentially within a file but files can still run in parallel processes
    // safely once per-test transaction isolation exists (added alongside the
    // first module that touches the database, Session 3).
  },
});
