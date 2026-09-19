import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { AppError, ErrorCode } from '../../lib/errors.js';
import { docSchema, noopSerializerCompiler, noopValidatorCompiler } from '../../lib/routeDocs.js';
import { assertCanReadPatient, getAuthenticatedUser, requireAuth } from '../../plugins/auth.js';
import { demoFireResponseSchema, reminderListResponseSchema } from './docSchemas.js';
import { demoFireSchema } from './schemas.js';
import * as remindersService from './service.js';

const patientIdParamsSchema = z.object({ id: z.uuid() });

// docs/API_CONTRACT.md's endpoint table, REQ-REMIND-005/007. Not wrapped in
// fastify-plugin (fp()) - same reason as every other module's routes.ts.
export async function remindersRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/patients/:id/reminders',
    {
      preHandler: requireAuth,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Upcoming and recently sent reminders for a patient',
        description:
          'REQ-REMIND-005. canRead-gated (REQ-ROLE-003). Upcoming pending + last 20 sent.',
        tags: ['reminders'],
        response200: reminderListResponseSchema,
      }),
    },
    async (request, reply) => {
      const { id: patientId } = patientIdParamsSchema.parse(request.params);
      const actor = getAuthenticatedUser(request);
      // Existence-then-access, same discipline as every other patient-scoped
      // GET in this codebase.
      await remindersService.findPatientOrThrow(patientId);
      await assertCanReadPatient(actor, patientId);
      const items = await remindersService.listReminders(patientId);
      return reply.ok({ items });
    },
  );

  app.post(
    '/demo/reminders/fire',
    {
      preHandler: requireAuth,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Force the next pending reminder for a patient to fire now (demo only)',
        description: 'REQ-REMIND-007. SMS_MODE=mock only; 404 otherwise.',
        tags: ['reminders'],
        body: demoFireSchema,
        response200: demoFireResponseSchema,
      }),
    },
    async (request, reply) => {
      if (config.SMS_MODE !== 'mock') {
        throw new AppError(ErrorCode.NOT_FOUND, 'Not found');
      }
      const { patientId } = demoFireSchema.parse(request.body);
      const reminder = await remindersService.fireNextReminder(patientId);
      return reply.ok({ reminder });
    },
  );
}
