import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { prisma } from './lib/prisma.js';

// Liveness: process is up, nothing else. Readiness: process is up AND the
// database is actually reachable (docs/ARCHITECTURE.md §8's foundation scope,
// Session 2 step 7). Neither goes through the {ok,data} envelope - these are
// infra probes, not API data, and orchestrators expect a plain body.
export const healthPlugin = fp(async (app: FastifyInstance) => {
  app.get('/health/live', async () => {
    return { status: 'ok' };
  });

  app.get('/health/ready', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch (err) {
      app.log.error({ err }, 'readiness check failed: database unreachable');
      reply.status(503);
      return { status: 'unavailable' };
    }
  });
});
