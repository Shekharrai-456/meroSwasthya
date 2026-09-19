import type { FastifyInstance } from 'fastify';
import { docSchema, noopSerializerCompiler, noopValidatorCompiler } from '../../lib/routeDocs.js';
import { getAuthenticatedUser, requireAuth } from '../../plugins/auth.js';
import { syncPullResponseSchema, syncPushResponseSchema } from './docSchemas.js';
import { syncPullQuerySchema, syncPushSchema } from './schemas.js';
import * as syncService from './service.js';

// docs/API_CONTRACT.md's endpoint table, REQ-SYNC-*. Not wrapped in
// fastify-plugin (fp()) - same reason as every other module's routes.ts.
export async function syncRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/sync/push',
    {
      preHandler: requireAuth,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Push queued local changes',
        description:
          'REQ-SYNC-001..008. Up to 50 changes, each applied independently in its own unit of work; the batch never fails wholesale.',
        tags: ['sync'],
        body: syncPushSchema,
        response200: syncPushResponseSchema,
      }),
    },
    async (request, reply) => {
      const input = syncPushSchema.parse(request.body);
      const result = await syncService.pushBatch(getAuthenticatedUser(request), input);
      return reply.ok(result);
    },
  );

  app.get(
    '/sync/pull',
    {
      preHandler: requireAuth,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Pull rows changed since a cursor',
        description:
          'REQ-SYNC-009..011. Owned union active-grant patients only; ordered updatedAt asc; page size 200.',
        tags: ['sync'],
        response200: syncPullResponseSchema,
      }),
    },
    async (request, reply) => {
      const query = syncPullQuerySchema.parse(request.query);
      const result = await syncService.pullChanges(getAuthenticatedUser(request), query);
      return reply.ok(result);
    },
  );
}
