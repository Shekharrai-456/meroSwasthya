import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Role } from '../../../generated/prisma/enums.js';
import { docSchema, noopSerializerCompiler, noopValidatorCompiler } from '../../lib/routeDocs.js';
import { getAuthenticatedUser, requireAuth, requireRole } from '../../plugins/auth.js';
import {
  grantCreateResponseSchema,
  grantRedeemResponseSchema,
  grantRevokeResponseSchema,
} from './docSchemas.js';
import { grantCreateSchema, grantRedeemSchema } from './schemas.js';
import * as grantsService from './service.js';

const grantIdParamsSchema = z.object({ id: z.uuid() });

// docs/API_CONTRACT.md §12's endpoint table, REQ-GRANT-*. Not wrapped in
// fastify-plugin (fp()) - see modules/patients/routes.ts's comment; the
// Session 3 bug this avoids applies to every module the same way.
export async function grantsRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/grants',
    {
      preHandler: requireAuth,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Create an access grant (QR share)',
        description:
          'REQ-GRANT-001/002/012. Owner-only, rate-limited 20/hour/patient. Pass `printed: true` for the 1-year printed-card variant (forces scope="read", requires the patient PIN at redeem) instead of `scope`/`ttlMinutes`.',
        tags: ['grants'],
        body: grantCreateSchema,
        response200: grantCreateResponseSchema,
      }),
    },
    async (request, reply) => {
      const input = grantCreateSchema.parse(request.body);
      const result = await grantsService.createGrant(getAuthenticatedUser(request), input);
      return reply.ok(result);
    },
  );

  app.post(
    '/grants/redeem',
    {
      preHandler: [requireAuth, requireRole(Role.provider, Role.fchv)],
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Redeem a scanned grant QR code',
        description:
          "REQ-GRANT-003..007/012. Role must be provider or fchv. Idempotent for the redeeming user; 409 ALREADY_REDEEMED for anyone else. A printed-card grant additionally requires the patient's 4-digit `pin` in the body on first redemption.",
        tags: ['grants'],
        body: grantRedeemSchema,
        response200: grantRedeemResponseSchema,
      }),
    },
    async (request, reply) => {
      const input = grantRedeemSchema.parse(request.body);
      const result = await grantsService.redeemGrant(getAuthenticatedUser(request), input);
      return reply.ok(result);
    },
  );

  app.post(
    '/grants/:id/revoke',
    {
      preHandler: requireAuth,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Revoke an access grant',
        description: 'REQ-GRANT-008/009. Owner-only; provider access ends immediately.',
        tags: ['grants'],
        response200: grantRevokeResponseSchema,
      }),
    },
    async (request, reply) => {
      const { id } = grantIdParamsSchema.parse(request.params);
      const grant = await grantsService.revokeGrant(getAuthenticatedUser(request), id);
      return reply.ok({ grant });
    },
  );
}
