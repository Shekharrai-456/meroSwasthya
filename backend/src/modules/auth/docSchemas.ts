import { z } from 'zod';

// Documentation-only shapes mirroring lib/serializers.ts's UserDto and
// service.ts's result types (docs/openapi.json export - CLAUDE.md §8). Never
// imported by service.ts/routes.ts for actual typing or validation; see
// lib/routeDocs.ts's noopValidatorCompiler/noopSerializerCompiler for why
// duplicating the shape here can never desync from and corrupt a real
// response.
export const userDtoSchema = z.object({
  id: z.string(),
  phone: z.string(),
  role: z.enum(['patient', 'provider', 'fchv', 'admin']),
  name: z.string(),
  facilityId: z.string().nullable(),
  facilityName: z.string().nullable(),
  createdAt: z.string(),
});

export const otpRequestResponseSchema = z.object({
  otpSentTo: z.string(),
  expiresInSec: z.number(),
  demoOtp: z.string().optional(),
});

export const otpVerifyResponseSchema = z.object({
  tempToken: z.string(),
  hasPin: z.boolean(),
  isNewUser: z.boolean(),
});

export const authTokensResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: userDtoSchema,
});

export const refreshResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const userWrapperResponseSchema = z.object({
  user: userDtoSchema,
});
