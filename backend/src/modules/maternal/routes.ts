import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { docSchema, noopSerializerCompiler, noopValidatorCompiler } from '../../lib/routeDocs.js';
import { assertCanReadPatient, getAuthenticatedUser, requireAuth } from '../../plugins/auth.js';
import {
  contactRecordResponseSchema,
  deliveryResponseSchema,
  pregnancyBundleResponseSchema,
  pregnancyCreateResponseSchema,
  pregnancyWrapperResponseSchema,
} from './docSchemas.js';
import {
  contactNoParamsSchema,
  contactRecordSchema,
  deliveryCreateSchema,
  pregnancyCreateSchema,
  pregnancyUpdateSchema,
} from './schemas.js';
import * as maternalService from './service.js';

const patientIdParamsSchema = z.object({ id: z.uuid() });
const pregnancyIdParamsSchema = z.object({ id: z.uuid() });

// docs/API_CONTRACT.md's endpoint table, REQ-PREG-*. Not wrapped in
// fastify-plugin (fp()) - same reason as every other module's routes.ts.
export async function maternalRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/patients/:id/pregnancies',
    {
      preHandler: requireAuth,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Register a pregnancy',
        description:
          'REQ-PREG-001..007. canAppendPatient (owner, provider, fchv). Patient must be female, no second active pregnancy. Creates 8 AncContacts + anc_due/anc_missed reminders.',
        tags: ['maternal'],
        body: pregnancyCreateSchema,
        response200: pregnancyCreateResponseSchema,
      }),
    },
    async (request, reply) => {
      const { id: patientId } = patientIdParamsSchema.parse(request.params);
      const input = pregnancyCreateSchema.parse(request.body);
      const result = await maternalService.createPregnancy(
        getAuthenticatedUser(request),
        patientId,
        input,
      );
      return reply.ok(result);
    },
  );

  app.get(
    '/pregnancies/:id',
    {
      preHandler: requireAuth,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Get a pregnancy with contacts, delivery, and reminders',
        description: 'REQ-PREG-008. canRead-gated (REQ-ROLE-003).',
        tags: ['maternal'],
        response200: pregnancyBundleResponseSchema,
      }),
    },
    async (request, reply) => {
      const { id: pregnancyId } = pregnancyIdParamsSchema.parse(request.params);
      const actor = getAuthenticatedUser(request);
      const bundle = await maternalService.getPregnancyBundle(pregnancyId);
      await assertCanReadPatient(actor, bundle.pregnancy.patientId);
      return reply.ok(bundle);
    },
  );

  app.patch(
    '/pregnancies/:id',
    {
      preHandler: requireAuth,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Update birthPlan / riskFactors / close a pregnancy',
        description: 'REQ-PREG-009. Version-checked; status may only be set to "ended" here.',
        tags: ['maternal'],
        body: pregnancyUpdateSchema,
        response200: pregnancyWrapperResponseSchema,
      }),
    },
    async (request, reply) => {
      const { id: pregnancyId } = pregnancyIdParamsSchema.parse(request.params);
      const input = pregnancyUpdateSchema.parse(request.body);
      const pregnancy = await maternalService.updatePregnancy(
        getAuthenticatedUser(request),
        pregnancyId,
        input,
      );
      return reply.ok({ pregnancy });
    },
  );

  app.put(
    '/pregnancies/:id/contacts/:contactNo',
    {
      preHandler: requireAuth,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Record an ANC contact',
        description:
          'REQ-PREG-010..014. canAppendPatient. Server computes triage (RULES) and returns it; the app must display the server value if it differs from what it computed locally.',
        tags: ['maternal'],
        body: contactRecordSchema,
        response200: contactRecordResponseSchema,
      }),
    },
    async (request, reply) => {
      const { id: pregnancyId, contactNo } = contactNoParamsSchema.parse(request.params);
      const input = contactRecordSchema.parse(request.body);
      const result = await maternalService.recordContact(
        getAuthenticatedUser(request),
        pregnancyId,
        contactNo,
        input,
      );
      return reply.ok(result);
    },
  );

  app.post(
    '/pregnancies/:id/delivery',
    {
      preHandler: requireAuth,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Close the pregnancy with a delivery record',
        description:
          'REQ-PREG-015. Pregnancy must be active; idempotent on the client-generated delivery id; cancels pending reminders.',
        tags: ['maternal'],
        body: deliveryCreateSchema,
        response200: deliveryResponseSchema,
      }),
    },
    async (request, reply) => {
      const { id: pregnancyId } = pregnancyIdParamsSchema.parse(request.params);
      const input = deliveryCreateSchema.parse(request.body);
      const result = await maternalService.recordDelivery(
        getAuthenticatedUser(request),
        pregnancyId,
        input,
      );
      return reply.ok(result);
    },
  );
}
