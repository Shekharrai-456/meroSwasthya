import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { docSchema, noopSerializerCompiler } from '../../lib/routeDocs.js';
import { CODELIST_VERSION } from '../codelists/service.js';
import rules from '../maternal/rules/rules.json' with { type: 'json' };

// docs/API_CONTRACT.md's endpoint table, REQ-META-001/002. Auth: none.
// GET /demo/sms(.html) live here per backend.md's directory tree
// (`meta/routes.ts // /rules, /config, /demo/sms(.html)`) but need the
// Reminders module's `MockSms` table to exist first (Phase 8, NOT_STARTED) -
// not added yet, same "only what's needed now" discipline as every earlier
// pull-forward in this project.

// Loose shape for docs purposes only - the real response is the RULES
// object served verbatim (backend.md A.4: "data: <RULES object exactly as
// in the Shared rules chapter>"), not re-typed field by field here.
const rulesResponseSchema = z.record(z.string(), z.unknown());

const configResponseSchema = z.object({
  smsMode: z.enum(['mock', 'sparrow']),
  aiSummaryEnabled: z.boolean(),
  otpDemo: z.boolean(),
  rulesVersion: z.string(),
  codelistVersion: z.string(),
});

export async function metaRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/rules',
    {
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'The shared RULES table verbatim',
        description: 'REQ-META-001. ancSchedule, dangerSigns, riskFactors, triage, reminders.',
        tags: ['meta'],
        response200: rulesResponseSchema,
      }),
    },
    async (_request, reply) => reply.ok(rules),
  );

  app.get(
    '/config',
    {
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Feature flags',
        description: 'REQ-META-002. Lets the app hide unavailable features.',
        tags: ['meta'],
        response200: configResponseSchema,
      }),
    },
    async (_request, reply) =>
      reply.ok({
        smsMode: config.SMS_MODE,
        aiSummaryEnabled: config.AI_MODE === 'on',
        otpDemo: config.OTP_MODE === 'demo',
        rulesVersion: rules.version,
        codelistVersion: CODELIST_VERSION,
      }),
  );
}
