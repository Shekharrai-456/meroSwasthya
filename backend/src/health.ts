import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';

// Liveness: process is up, nothing else. Readiness: process is up AND its
// hard dependencies are reachable (docs/ARCHITECTURE.md §8's foundation
// scope, Session 2 step 7; Redis added in Session 3 since OTP rate-limiting
// and PIN lockout - REQ-AUTH-002/006 - now depend on it same as Postgres).
// Neither goes through the {ok,data} envelope - these are infra probes, not
// API data, and orchestrators expect a plain body.
export const healthPlugin = fp(async (app: FastifyInstance) => {
  app.get('/health/live', async () => {
    return { status: 'ok' };
  });

  app.get('/health/ready', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await redis.ping();
      return { status: 'ok' };
    } catch (err) {
      app.log.error({ err }, 'readiness check failed: dependency unreachable');
      reply.status(503);
      return { status: 'unavailable' };
    }
  });
});
