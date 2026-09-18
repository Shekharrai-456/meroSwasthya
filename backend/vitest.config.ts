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
    // Real Postgres per CLAUDE.md §10 means tests share one server. Session 3
    // adds truncate-between-tests isolation (test/helpers/db.ts's resetDb())
    // rather than per-test transactions, since every route handler shares one
    // process-wide Prisma client singleton (src/lib/prisma.ts) - truncation
    // is safe within a file (tests there already run sequentially) but not
    // across files running concurrently against the same database, hence
    // fileParallelism: false below. This is a deliberate, documented
    // deviation from "tests must pass in parallel" (CLAUDE.md §10) - see
    // docs/PROGRESS.md's Session 3 entry.
    fileParallelism: false,
  },
});
