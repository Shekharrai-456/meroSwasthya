import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config.js';
import { envelopePlugin } from './plugins/envelope.js';
import { rateLimitPlugin } from './plugins/ratelimit.js';
import { healthPlugin } from './health.js';

// buildApp() is the one place the app is assembled - used by both server.ts
// (real listen) and every test file (via .inject(), docs/TECH_DECISIONS.md's
// testing section). Registration order matters: envelope must be registered
// before anything that can throw, so its error handler is the one that wins.
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    genReqId: () => randomUUID(),
    disableRequestLogging: true, // replaced by the structured hook below
    logger: {
      level: config.LOG_LEVEL,
      transport: config.isProduction
        ? undefined
        : { target: 'pino-pretty', options: { colorize: true, singleLine: true } },
      // Never log request/response bodies - PINs, OTPs, tokens, message text
      // must never reach a log line (REQ-SEC-004). Only safe metadata below.
      serializers: {
        req: (req) => ({ method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    },
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    return payload;
  });

  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        path: request.url,
        status: reply.statusCode,
        ms: reply.elapsedTime,
        userId: (request as { userId?: string }).userId ?? null,
        requestId: request.id,
      },
      'request completed',
    );
  });

  await app.register(cors, { origin: config.corsOrigins });
  await app.register(helmet);
  await app.register(envelopePlugin);
  await app.register(rateLimitPlugin);
  await app.register(healthPlugin);

  return app;
}
