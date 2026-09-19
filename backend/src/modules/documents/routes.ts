import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { docSchema, noopSerializerCompiler, noopValidatorCompiler } from '../../lib/routeDocs.js';
import { getAuthenticatedUser, requireAuth } from '../../plugins/auth.js';
import { documentPresignResponseSchema, documentWrapperResponseSchema } from './docSchemas.js';
import { documentPresignSchema } from './schemas.js';
import * as documentsService from './service.js';

const documentIdParamsSchema = z.object({ id: z.uuid() });

// docs/API_CONTRACT.md's endpoint table, REQ-DOC-*. Not wrapped in
// fastify-plugin (fp()) - same reason as every other module's routes.ts.
export async function documentsRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/documents/presign',
    {
      preHandler: requireAuth,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Register document metadata and get a presigned upload URL',
        description: 'REQ-DOC-001/002/003. canAppendPatient; size <= 2 MB; image/jpeg only.',
        tags: ['documents'],
        body: documentPresignSchema,
        response200: documentPresignResponseSchema,
      }),
    },
    async (request, reply) => {
      const input = documentPresignSchema.parse(request.body);
      const result = await documentsService.presignDocument(getAuthenticatedUser(request), input);
      return reply.ok(result);
    },
  );

  app.post(
    '/documents/:id/complete',
    {
      preHandler: requireAuth,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Confirm an upload finished',
        description:
          'REQ-DOC-004. HEAD-checks the object; sets status=uploaded; audits document_added.',
        tags: ['documents'],
        response200: documentWrapperResponseSchema,
      }),
    },
    async (request, reply) => {
      const { id } = documentIdParamsSchema.parse(request.params);
      const document = await documentsService.completeDocument(getAuthenticatedUser(request), id);
      return reply.ok({ document });
    },
  );

  app.get(
    '/documents/:id',
    {
      preHandler: requireAuth,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Get document metadata and a fresh download URL',
        description: 'REQ-DOC-005. canRead-gated (REQ-ROLE-003).',
        tags: ['documents'],
        response200: documentWrapperResponseSchema,
      }),
    },
    async (request, reply) => {
      const { id } = documentIdParamsSchema.parse(request.params);
      const document = await documentsService.getDocument(getAuthenticatedUser(request), id);
      return reply.ok({ document });
    },
  );

  app.post(
    '/documents/:id/summarize',
    {
      preHandler: requireAuth,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Request an AI draft summary (Tier 2)',
        description:
          'REQ-DOC-006/007. 501 NOT_IMPLEMENTED when AI_MODE=off. Otherwise queues the ai-summary job and returns immediately with aiSummaryStatus=queued; poll GET /documents/:id for aiSummaryStatus=done/failed.',
        tags: ['documents'],
        response200: documentWrapperResponseSchema,
      }),
    },
    async (request, reply) => {
      const { id } = documentIdParamsSchema.parse(request.params);
      const document = await documentsService.summarizeDocument(getAuthenticatedUser(request), id);
      return reply.ok({ document });
    },
  );
}
