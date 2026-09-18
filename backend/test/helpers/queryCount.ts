import { prisma } from '../../src/lib/prisma.js';

// CLAUDE.md §7: "No N+1 queries... check the query count in a test." Counts
// real Prisma query events (src/lib/prisma.ts's `log: [{level:'query',
// emit:'event'}]`) fired while `fn` runs - not a mock, a count of the actual
// SQL statements sent to the real database.
//
// Prisma's client doesn't expose an $off/unsubscribe for $on('query', ...),
// so one listener is registered once at module load and every query is
// counted globally; countQueries() reports the delta across its own window
// rather than adding/removing a listener per call.
let totalQueries = 0;
prisma.$on('query', () => {
  totalQueries += 1;
});

export async function countQueries(fn: () => Promise<void>): Promise<number> {
  const before = totalQueries;
  await fn();
  return totalQueries - before;
}
