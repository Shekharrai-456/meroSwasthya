import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import Fastify, { type FastifyInstance } from 'fastify';
import { config } from './config.js';
import { healthPlugin } from './health.js';
import { authRoutes } from './modules/auth/routes.js';
import { codelistsRoutes } from './modules/codelists/routes.js';
import { documentsRoutes } from './modules/documents/routes.js';
import { facilitiesRoutes } from './modules/facilities/routes.js';
import { grantsRoutes } from './modules/grants/routes.js';
import { maternalRoutes } from './modules/maternal/routes.js';
import { metaRoutes } from './modules/meta/routes.js';
import { patientsRoutes } from './modules/patients/routes.js';
import { remindersRoutes } from './modules/reminders/routes.js';
import { syncRoutes } from './modules/sync/routes.js';
import { visitsRoutes } from './modules/visits/routes.js';
import { envelopePlugin } from './plugins/envelope.js';
import { rateLimitPlugin } from './plugins/ratelimit.js';

export interface BuildAppOptions {
  // Test-only seam (test/auth.test.ts's log-leak assertions, REQ-SEC-004):
  // route logs to this synchronous stream instead of the pino-pretty worker
  // thread, so a test can inspect exactly what was logged. Omitted in real
  // use (server.ts), which keeps the normal pretty-printed dev transport.
  logStream?: { write(msg: string): void };
}

// buildApp() is the one place the app is assembled - used by both server.ts
// (real listen) and every test file (via .inject(), docs/TECH_DECISIONS.md's
// testing section). Registration order matters: envelope must be registered
// before anything that can throw, so its error handler is the one that wins.
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    genReqId: () => randomUUID(),
    disableRequestLogging: true, // replaced by the structured hook below
    logger: {
      level: config.LOG_LEVEL,
      ...(options.logStream
        ? { stream: options.logStream }
        : {
            transport: config.isProduction
              ? undefined
              : { target: 'pino-pretty', options: { colorize: true, singleLine: true } },
          }),
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
        userId: request.user?.id ?? null,
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

  // Docs-only: every route's schema.body/response is built with
  // noopValidatorCompiler/noopSerializerCompiler (lib/routeDocs.ts), so this
  // plugin only ever reads route.schema to produce docs/openapi.json
  // (scripts/export-openapi.ts, CLAUDE.md §8) - it never affects runtime
  // request handling.
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: { title: 'Swasthya Card API', version: '0.1.0' },
      servers: [{ url: '/api/v1' }],
    },
  });

  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(patientsRoutes, { prefix: '/api/v1' });
  await app.register(grantsRoutes, { prefix: '/api/v1' });
  await app.register(visitsRoutes, { prefix: '/api/v1' });
  await app.register(maternalRoutes, { prefix: '/api/v1' });
  await app.register(facilitiesRoutes, { prefix: '/api/v1' });
  await app.register(codelistsRoutes, { prefix: '/api/v1' });
  await app.register(metaRoutes, { prefix: '/api/v1' });
  await app.register(remindersRoutes, { prefix: '/api/v1' });
  await app.register(syncRoutes, { prefix: '/api/v1' });
  await app.register(documentsRoutes, { prefix: '/api/v1' });

  return app;
}
