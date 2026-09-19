import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { docSchema, noopSerializerCompiler, noopValidatorCompiler } from '../../lib/routeDocs.js';
import { assertCanReadPatient, getAuthenticatedUser, requireAuth } from '../../plugins/auth.js';
import {
  auditListResponseSchema,
  patientDetailResponseSchema,
  patientListResponseSchema,
  patientWrapperResponseSchema,
  timelineResponseSchema,
} from './docSchemas.js';
import { patientCreateSchema, patientUpdateSchema, timelineQuerySchema } from './schemas.js';
import * as patientsService from './service.js';

const patientIdParamsSchema = z.object({ id: z.uuid() });

// docs/API_CONTRACT.md §12's endpoint table, REQ-PATIENT-*, REQ-ROLE-*. Not
// wrapped in fastify-plugin (fp()) - that wrapper silently broke
// {prefix}-based route registration in Session 3 (docs/PROGRESS.md), so
// every module's routes.ts stays a plain exported async function.
export async function patientsRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/patients',
    {
      preHandler: requireAuth,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Create a family profile',
        description:
          'REQ-PATIENT-001/002. Client-generated id; posting the same id twice is idempotent for its owner, FORBIDDEN for anyone else.',
        tags: ['patients'],
        body: patientCreateSchema,
        response200: patientWrapperResponseSchema,
      }),
    },
    async (request, reply) => {
      const input = patientCreateSchema.parse(request.body);
      const patient = await patientsService.createPatient(getAuthenticatedUser(request), input);
      return reply.ok({ patient });
    },
  );

  app.get(
    '/patients',
    {
      preHandler: requireAuth,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'List patients visible to the caller',
        description:
          'REQ-ROLE-007. patient role: owned only. provider/fchv: owned union active-grant patients. No pagination (small, bounded lists).',
        tags: ['patients'],
        response200: patientListResponseSchema,
      }),
    },
    async (request, reply) => {
      const items = await patientsService.listPatients(getAuthenticatedUser(request));
      return reply.ok({ items });
    },
  );

  app.get(
    '/patients/:id',
    {
      preHandler: requireAuth,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Get a single patient with its computed summary',
        description: 'REQ-PATIENT-004..007. canRead-gated (REQ-ROLE-003).',
        tags: ['patients'],
        response200: patientDetailResponseSchema,
      }),
    },
    async (request, reply) => {
      const { id } = patientIdParamsSchema.parse(request.params);
      const actor = getAuthenticatedUser(request);
      // Existence checked before authorization, on purpose: API_CONTRACT.md's
      // error table gives 404 NOT_FOUND and 403 FORBIDDEN distinct meanings
      // ("doesn't exist" vs "exists, no access") - reversing this order would
      // report FORBIDDEN for ids that were never real, which is wrong, not
      // just differently-worded (found as a real test failure, not by
      // inspection - see docs/PROGRESS.md's Session 4 entry).
      const { patient, summary } = await patientsService.getPatient(id);
      await assertCanReadPatient(actor, id);
      return reply.ok({ patient, summary });
    },
  );

  app.get(
    '/patients/:id/timeline',
    {
      preHandler: requireAuth,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Unified chronological feed for a patient',
        description:
          'REQ-PATIENT-008/009. canRead-gated. Unions visits, documents, pregnancy-registered, done ANC contacts, and deliveries; cursor-paginated on `before`, limit 50.',
        tags: ['patients'],
        response200: timelineResponseSchema,
      }),
    },
    async (request, reply) => {
      const { id } = patientIdParamsSchema.parse(request.params);
      const query = timelineQuerySchema.parse(request.query);
      const actor = getAuthenticatedUser(request);
      // Same 404-before-403 ordering as GET /patients/:id above.
      const result = await patientsService.getPatientTimeline(id, query);
      await assertCanReadPatient(actor, id);
      return reply.ok(result);
    },
  );

  app.patch(
    '/patients/:id',
    {
      preHandler: requireAuth,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Update a patient (owner only)',
        description:
          'REQ-PATIENT-003. Optimistic concurrency via `version`; mismatch -> 409 VERSION_CONFLICT.',
        tags: ['patients'],
        body: patientUpdateSchema,
        response200: patientWrapperResponseSchema,
      }),
    },
    async (request, reply) => {
      const { id } = patientIdParamsSchema.parse(request.params);
      const input = patientUpdateSchema.parse(request.body);
      const patient = await patientsService.updatePatient(getAuthenticatedUser(request), id, input);
      return reply.ok({ patient });
    },
  );

  app.get(
    '/patients/:id/audit',
    {
      preHandler: requireAuth,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: "Who viewed this patient's record",
        description: 'REQ-PATIENT-010, REQ-AUDIT-003. Owner-only, newest-first.',
        tags: ['patients'],
        response200: auditListResponseSchema,
      }),
    },
    async (request, reply) => {
      const { id } = patientIdParamsSchema.parse(request.params);
      const items = await patientsService.getPatientAudit(getAuthenticatedUser(request), id);
      return reply.ok({ items });
    },
  );
}
