import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import { config } from '../config.js';

// One client per process (Prisma's own recommendation) - every module imports
// this instead of constructing its own PrismaClient. Prisma 7's `prisma-client`
// generator requires an explicit driver adapter (docs/TECH_DECISIONS.md's
// Prisma section, updated during Session 2 once this was discovered).
const adapter = new PrismaPg({ connectionString: config.DATABASE_URL });
export const prisma = new PrismaClient({ adapter });
