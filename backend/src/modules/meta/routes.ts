import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { AppError, ErrorCode } from '../../lib/errors.js';
import { docSchema, noopSerializerCompiler } from '../../lib/routeDocs.js';
import { prisma } from '../../lib/prisma.js';
import { CODELIST_VERSION } from '../codelists/service.js';
import rules from '../maternal/rules/rules.json' with { type: 'json' };

// docs/API_CONTRACT.md's endpoint table, REQ-META-001/002/REQ-REMIND-006.
// Auth: none. GET /demo/sms(.html) live here per backend.md's directory tree
// (`meta/routes.ts // /rules, /config, /demo/sms(.html)`).

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

const mockSmsItemSchema = z.object({ to: z.string(), text: z.string(), sentAt: z.string() });
const demoSmsResponseSchema = z.object({ items: z.array(mockSmsItemSchema) });

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

  app.get(
    '/demo/sms',
    {
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Mock SMS outbox (SMS_MODE=mock only)',
        description: 'REQ-REMIND-006. 404 when SMS_MODE != mock. Last 50, newest first.',
        tags: ['reminders'],
        response200: demoSmsResponseSchema,
      }),
    },
    async (_request, reply) => {
      if (config.SMS_MODE !== 'mock') {
        throw new AppError(ErrorCode.NOT_FOUND, 'Not found');
      }
      const rows = await prisma.mockSms.findMany({ orderBy: { sentAt: 'desc' }, take: 50 });
      return reply.ok({
        items: rows.map((row) => ({
          to: row.to,
          text: row.text,
          sentAt: row.sentAt.toISOString(),
        })),
      });
    },
  );

  // REQ-REMIND-006: a plain HTML page, not part of the JSON API envelope -
  // deliberately outside docSchema/OpenAPI, which describe the JSON contract
  // only. Auto-refreshes via <meta http-equiv="refresh">, server-rendered on
  // every hit rather than client-side JS, for a projector on an
  // unpredictable venue network.
  app.get('/demo/sms.html', async (_request, reply) => {
    if (config.SMS_MODE !== 'mock') {
      throw new AppError(ErrorCode.NOT_FOUND, 'Not found');
    }
    const rows = await prisma.mockSms.findMany({ orderBy: { sentAt: 'desc' }, take: 50 });
    const rowsHtml = rows
      .map(
        (row) =>
          `<tr><td>${escapeHtml(row.sentAt.toISOString())}</td><td>${escapeHtml(row.to)}</td><td>${escapeHtml(row.text)}</td></tr>`,
      )
      .join('\n');
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="3">
<title>Swasthya Card — Mock SMS</title>
<style>
  body { font-family: sans-serif; font-size: 28px; background: #111; color: #eee; margin: 0; padding: 24px; }
  h1 { font-size: 40px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 12px; border-bottom: 1px solid #444; vertical-align: top; }
  td:first-child { font-size: 18px; color: #888; white-space: nowrap; }
</style>
</head>
<body>
<h1>Mock SMS outbox</h1>
<table>${rowsHtml}</table>
</body>
</html>`;
    reply.type('text/html');
    return reply.send(html);
  });
}
