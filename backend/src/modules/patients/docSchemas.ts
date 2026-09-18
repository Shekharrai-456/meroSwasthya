import { z } from 'zod';

// Documentation-only shapes (docs/openapi.json) - see lib/routeDocs.ts's
// noopValidatorCompiler/noopSerializerCompiler for why these can never
// desync from and corrupt a real response.
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

export const patientListResponseSchema = z.object({
  items: z.array(patientDtoSchema),
});

export const auditEntryDtoSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  actorUserId: z.string(),
  actorName: z.string(),
  actorFacilityName: z.string().nullable(),
  action: z.enum([
    'grant_created',
    'grant_redeemed',
    'record_viewed',
    'visit_added',
    'contact_recorded',
    'document_added',
    'grant_revoked',
  ]),
  grantId: z.string().nullable(),
  at: z.string(),
});

export const auditListResponseSchema = z.object({
  items: z.array(auditEntryDtoSchema),
});
