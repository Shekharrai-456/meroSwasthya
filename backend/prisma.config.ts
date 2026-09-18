import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 moved the datasource connection string here from schema.prisma
// (docs/TECH_DECISIONS.md's Prisma section + this file's discovery note in
// prisma/schema.prisma). Only the CLI (migrate/generate/seed) reads this file;
// the running app connects via the adapter in src/lib/prisma.ts instead.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
