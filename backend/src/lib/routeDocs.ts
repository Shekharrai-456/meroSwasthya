import type { FastifySchema } from 'fastify';
import { z } from 'zod';

// docs/ARCHITECTURE.md §3 fixes validation as "exclusively in modules/*/
// schemas.ts (zod), called at the top of the route handler" - manual
// `schema.parse()`, not Fastify's own AJV-driven schema validation, because
// zod is what produces REQ-API-002's field-level VALIDATION_ERROR details
// shape (plugins/envelope.ts's ZodError branch). This noop compiler is how a
// route keeps a `schema.body`/`schema.response` block (so @fastify/swagger
// can still document it - see scripts/export-openapi.ts) without Fastify's
// AJV validating the request a second time, in a different shape, before the
// handler's manual zod.parse() ever runs.
export function noopValidatorCompiler(): (data: unknown) => { value: unknown } {
  return (data: unknown) => ({ value: data });
}

// Symmetric to noopValidatorCompiler, on the output side: schema.response is
// otherwise used by Fastify to compile a fast-json-stringify serializer that
// SILENTLY DROPS any property not listed in the schema. That's too risky to
// rely on here (a subtly-wrong docs schema could strip real fields from a
// real response), so response schemas stay documentation-only too - the
// actual output shape is guaranteed solely by lib/serializers.ts's
// whitelist-only DTO functions (REQ-API-007, REQ-USER-002).
export function noopSerializerCompiler(): (data: unknown) => string {
  return (data: unknown) => JSON.stringify(data);
}

// zod v4 ships a native JSON Schema converter (docs/TECH_DECISIONS.md's zod
// v4 entry) - no separate zod-to-json-schema dependency needed (CLAUDE.md
// §15's "one dependency per need").
export function zodJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'openapi-3.0' }) as Record<string, unknown>;
}

export interface DocRouteOptions {
  summary: string;
  description: string;
  tags: string[];
  body?: z.ZodType;
  response200: z.ZodType;
}

export function docSchema(opts: DocRouteOptions): FastifySchema {
  const schema: FastifySchema = {
    summary: opts.summary,
    description: opts.description,
    tags: opts.tags,
    response: {
      200: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', const: true },
          data: zodJsonSchema(opts.response200),
        },
      },
    },
  };
  if (opts.body) {
    schema.body = zodJsonSchema(opts.body);
  }
  return schema;
}
