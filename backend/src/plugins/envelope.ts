import fp from 'fastify-plugin';
import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError, ErrorCode } from '../lib/errors.js';

// The only place a response is shaped (docs/API_CONTRACT.md §3/§4, REQ-API-001..004).
// - reply.ok(data) is the ONLY way a route returns a success body.
// - The global error handler is the ONLY place an error becomes an HTTP response.

declare module 'fastify' {
  interface FastifyReply {
    ok<T>(data: T): FastifyReply;
  }
}

function zodErrorToDetails(error: ZodError): { field: string; message: string }[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

export const envelopePlugin = fp(async (app: FastifyInstance) => {
  app.decorateReply('ok', function ok<T>(this: FastifyReply, data: T) {
    return this.send({ ok: true, data });
  });

  app.setErrorHandler((error: FastifyError | AppError | ZodError | Error, request, reply) => {
    const requestId = request.id;

    if (error instanceof AppError) {
      reply.status(error.httpStatus).send({
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId,
        },
      });
      return;
    }

    if (error instanceof ZodError) {
      reply.status(400).send({
        ok: false,
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Validation failed',
          details: zodErrorToDetails(error),
          requestId,
        },
      });
      return;
    }

    // Fastify's own validation/parsing errors carry a statusCode; only 4xx ones
    // are safe to pass through as-is (payload too large, malformed JSON, etc.).
    // Anything else (or no statusCode) is an unexpected failure -> 500 INTERNAL,
    // full detail logged server-side only, nothing leaked to the client
    // (REQ-API-003, REQ-SEC-004 - no stack, no SQL, no internal message).
    const status =
      'statusCode' in error ? (error as { statusCode?: number }).statusCode : undefined;
    if (status && status >= 400 && status < 500) {
      request.log.warn({ err: error, requestId }, 'client error');
      reply.status(status).send({
        ok: false,
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: error.message,
          requestId,
        },
      });
      return;
    }

    request.log.error({ err: error, requestId }, 'unhandled error');
    reply.status(500).send({
      ok: false,
      error: {
        code: ErrorCode.INTERNAL,
        message: 'Something went wrong. Please try again.',
        requestId,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      ok: false,
      error: {
        code: ErrorCode.NOT_FOUND,
        message: 'Not found',
        requestId: request.id,
      },
    });
  });
});
