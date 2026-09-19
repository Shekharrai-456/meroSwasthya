import type { FastifyInstance } from 'fastify';
import { docSchema, noopSerializerCompiler, noopValidatorCompiler } from '../../lib/routeDocs.js';
import { requireAuth } from '../../plugins/auth.js';
import { facilitiesNearbyResponseSchema } from './docSchemas.js';
import { facilitiesNearbyQuerySchema } from './schemas.js';
import * as facilitiesService from './service.js';

// docs/API_CONTRACT.md's endpoint table, REQ-FACILITY-001. Not wrapped in
// fastify-plugin (fp()) - same reason as every other module's routes.ts.
export async function facilitiesRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/facilities/nearby',
    {
      preHandler: requireAuth,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Nearest facilities by straight-line distance',
        description: 'REQ-FACILITY-001. Haversine; optional birthing=true filter; sorted; limited.',
        tags: ['facilities'],
        response200: facilitiesNearbyResponseSchema,
      }),
    },
    async (request, reply) => {
      const query = facilitiesNearbyQuerySchema.parse(request.query);
      const items = await facilitiesService.listNearbyFacilities(query);
      return reply.ok({ items });
    },
  );
}
