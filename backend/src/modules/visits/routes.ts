import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { docSchema, noopSerializerCompiler, noopValidatorCompiler } from '../../lib/routeDocs.js';
import { assertCanReadPatient, getAuthenticatedUser, requireAuth } from '../../plugins/auth.js';
import { visitListResponseSchema, visitWrapperResponseSchema } from './docSchemas.js';
import { visitCreateSchema, visitListQuerySchema } from './schemas.js';
import * as visitsService from './service.js';

const patientIdParamsSchema = z.object({ id: z.uuid() });

// docs/API_CONTRACT.md's endpoint table, REQ-VISIT-*, REQ-ROLE-*. Not wrapped
// in fastify-plugin (fp()) - same reason as every other module's routes.ts
// (docs/PROGRESS.md's Session 3 fp() finding): it silently breaks
// {prefix}-based route registration.
export async function visitsRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/patients/:id/visits',
    {
      preHandler: requireAuth,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Record a clinical visit',
        description:
          'REQ-VISIT-001..006/009. Requires canAppendPatient AND role != fchv. Idempotent on the client-generated id. Creates a follow_up Reminder when followUpAt is set, and logs visit_added.',
        tags: ['visits'],
        body: visitCreateSchema,
        response200: visitWrapperResponseSchema,
      }),
    },
    async (request, reply) => {
      const { id: patientId } = patientIdParamsSchema.parse(request.params);
      const input = visitCreateSchema.parse(request.body);
      const visit = await visitsService.createVisit(
        getAuthenticatedUser(request),
        patientId,
        input,
      );
      return reply.ok({ visit });
    },
  );

  app.get(
    '/patients/:id/visits',
    {
      preHandler: requireAuth,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'List visits for a patient',
        description:
          'REQ-VISIT-007. canRead-gated (REQ-ROLE-003), newest first, default/max limit 50/200.',
        tags: ['visits'],
        response200: visitListResponseSchema,
      }),
    },
    async (request, reply) => {
      const { id: patientId } = patientIdParamsSchema.parse(request.params);
      const { limit } = visitListQuerySchema.parse(request.query);
      const actor = getAuthenticatedUser(request);
      // Existence checked before authorization - same 404-vs-403 discipline
      // as modules/patients/routes.ts's GET /patients/:id (a nonexistent id
      // must never read as FORBIDDEN).
      await visitsService.findPatientOrThrow(patientId);
      await assertCanReadPatient(actor, patientId);
      const items = await visitsService.listVisits(patientId, limit);
      return reply.ok({ items });
    },
  );
}
