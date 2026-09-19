import type { FastifyInstance } from 'fastify';
import { docSchema, noopSerializerCompiler, noopValidatorCompiler } from '../../lib/routeDocs.js';
import { codelistsResponseSchema } from './docSchemas.js';
import { codelistsQuerySchema } from './schemas.js';
import * as codelistsService from './service.js';

// docs/API_CONTRACT.md's endpoint table, REQ-CODELIST-001. Auth: none.
export async function codelistsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/codelists',
    {
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'All picklist items, optionally filtered by kind',
        description: 'REQ-CODELIST-001. Cached on the device with the returned version.',
        tags: ['codelists'],
        response200: codelistsResponseSchema,
      }),
    },
    async (request, reply) => {
      const { kind } = codelistsQuerySchema.parse(request.query);
      const items = await codelistsService.listCodelistItems(kind);
      reply.header('Cache-Control', 'public, max-age=3600');
      return reply.ok({ version: codelistsService.CODELIST_VERSION, items });
    },
  );
}
