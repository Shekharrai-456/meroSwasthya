import { z } from 'zod';

// Documentation-only shapes (docs/openapi.json) - see lib/routeDocs.ts.
export const grantDtoSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  scope: z.enum(['read', 'append']),
  tokenJti: z.string(),
  expiresAt: z.string(),
  redeemedByUserId: z.string().nullable(),
  redeemedAt: z.string().nullable(),
  accessUntil: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const grantCreateResponseSchema = z.object({
  grant: grantDtoSchema,
  token: z.string(),
  qrPayload: z.string(),
});

export const patientDtoSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  name: z.string(),
  sex: z.enum(['female', 'male', 'other']),
  dob: z.string(),
  bloodGroup: z.string().nullable(),
  ward: z.number().nullable(),
  municipality: z.string().nullable(),
  allergies: z.array(z.string()),
  chronicConditions: z.array(z.string()),
  emergencyContactPhone: z.string().nullable(),
  version: z.number(),
  updatedAt: z.string(),
  deleted: z.boolean(),
});

export const grantRedeemResponseSchema = z.object({
  grant: grantDtoSchema,
  patient: patientDtoSchema,
});

export const grantRevokeResponseSchema = z.object({
  grant: grantDtoSchema,
});
