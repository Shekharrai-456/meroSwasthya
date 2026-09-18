import type { FastifyInstance } from 'fastify';
import { Role } from '../../../generated/prisma/enums.js';
import { docSchema, noopSerializerCompiler, noopValidatorCompiler } from '../../lib/routeDocs.js';
import {
  getAuthenticatedUser,
  getTempPhone,
  requireAuth,
  requireRole,
  requireTemp,
} from '../../plugins/auth.js';
import {
  authTokensResponseSchema,
  otpRequestResponseSchema,
  otpVerifyResponseSchema,
  refreshResponseSchema,
  userWrapperResponseSchema,
} from './docSchemas.js';
import {
  otpRequestSchema,
  otpVerifySchema,
  pinLoginSchema,
  pinSetSchema,
  providerActivateSchema,
  refreshSchema,
} from './schemas.js';
import * as authService from './service.js';

// docs/API_CONTRACT.md §12's endpoint table, REQ-AUTH-*/REQ-USER-*. Every
// route: requireAuth/requireTemp (when applicable) -> zod schema.parse() ->
// authService call -> reply.ok(result), per docs/ARCHITECTURE.md §3's request
// lifecycle. No route touches Prisma directly (REQ-API-007).
//
// Deliberately NOT wrapped in fastify-plugin (fp()) - that was a real Session
// 3 bug found only once this ran against a real server: fp() breaks out of
// Fastify's encapsulation context, which is also what makes `register(...,
// {prefix})` apply. Every route below was silently registered at its bare
// path (e.g. `/auth/otp/request`) instead of `/api/v1/auth/otp/request`,
// discovered by printing the real route tree (`app.printRoutes()`) - see
// docs/PROGRESS.md.
export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/auth/otp/request',
    {
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Request an OTP',
        description: 'Starts login/registration. REQ-AUTH-002/003.',
        tags: ['auth'],
        body: otpRequestSchema,
        response200: otpRequestResponseSchema,
      }),
    },
    async (request, reply) => {
      const input = otpRequestSchema.parse(request.body);
      const result = await authService.requestOtp(input);
      return reply.ok(result);
    },
  );

  app.post(
    '/auth/otp/verify',
    {
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Verify an OTP',
        description: 'REQ-AUTH-004. Issues a 10-minute tempToken.',
        tags: ['auth'],
        body: otpVerifySchema,
        response200: otpVerifyResponseSchema,
      }),
    },
    async (request, reply) => {
      const input = otpVerifySchema.parse(request.body);
      const result = await authService.verifyOtp(input);
      return reply.ok(result);
    },
  );

  app.post(
    '/auth/pin/set',
    {
      preHandler: requireTemp,
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Set or reset the 4-digit PIN',
        description:
          'REQ-AUTH-005. Bearer tempToken required. Creates the user if new; ' +
          'overwrites pinHash if the user already exists (OPEN_QUESTIONS Q2).',
        tags: ['auth'],
        body: pinSetSchema,
        response200: authTokensResponseSchema,
      }),
    },
    async (request, reply) => {
      const input = pinSetSchema.parse(request.body);
      const phone = getTempPhone(request);
      const result = await authService.setPin(phone, input);
      return reply.ok(result);
    },
  );

  app.post(
    '/auth/pin/login',
    {
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Log in with phone + PIN',
        description: 'REQ-AUTH-006. Rate-limited and account-lockout protected.',
        tags: ['auth'],
        body: pinLoginSchema,
        response200: authTokensResponseSchema,
      }),
    },
    async (request, reply) => {
      const input = pinLoginSchema.parse(request.body);
      const result = await authService.loginWithPin(input, request.ip);
      return reply.ok(result);
    },
  );

  app.post(
    '/auth/refresh',
    {
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Rotate the refresh/access token pair',
        description:
          'REQ-AUTH-007/011. Reuse of an already-rotated token revokes the whole family.',
        tags: ['auth'],
        body: refreshSchema,
        response200: refreshResponseSchema,
      }),
    },
    async (request, reply) => {
      const input = refreshSchema.parse(request.body);
      const result = await authService.rotateRefreshToken(input);
      return reply.ok(result);
    },
  );

  app.post(
    '/auth/provider/activate',
    {
      preHandler: [requireAuth, requireRole(Role.patient)],
      validatorCompiler: noopValidatorCompiler,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Activate provider/fchv role via invite code',
        description: 'REQ-AUTH-008. Bearer access token required, role must be patient.',
        tags: ['auth'],
        body: providerActivateSchema,
        response200: userWrapperResponseSchema,
      }),
    },
    async (request, reply) => {
      const input = providerActivateSchema.parse(request.body);
      const user = await authService.activateProvider(getAuthenticatedUser(request).id, input);
      return reply.ok({ user });
    },
  );

  app.get(
    '/me',
    {
      preHandler: requireAuth,
      serializerCompiler: noopSerializerCompiler,
      schema: docSchema({
        summary: 'Current authenticated user',
        description: 'REQ-AUTH-009. Bearer access token required.',
        tags: ['auth'],
        response200: userWrapperResponseSchema,
      }),
    },
    async (request, reply) => {
      const user = await authService.getMe(getAuthenticatedUser(request).id);
      return reply.ok({ user });
    },
  );
}
