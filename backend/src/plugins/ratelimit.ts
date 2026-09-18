import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { ErrorCode } from '../lib/errors.js';

// Global default only (docs/SECURITY.md row: "global 300/min/IP"). Route-specific,
// tighter limits (OTP, PIN login, grant creation, document presign) are registered
// per-route inside their own modules, starting in Session 3 — this plugin only
// installs the shared infrastructure and the envelope-shaped 429 response.
export const rateLimitPlugin = fp(async (app: FastifyInstance) => {
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_request, context) => ({
      ok: false,
      error: {
        code: ErrorCode.RATE_LIMITED,
        message: `Too many requests, retry in ${context.after}`,
      },
    }),
  });
});
