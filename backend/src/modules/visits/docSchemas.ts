import { z } from 'zod';

// Documentation-only shapes (docs/openapi.json) - see lib/routeDocs.ts's
// noopValidatorCompiler/noopSerializerCompiler for why these can never
// desync from and corrupt a real response.

const prescriptionDtoSchema = z.object({
  id: z.string(),
  drugCode: z.string(),
  drugName: z.string(),
  dose: z.string(),
  frequency: z.enum(['OD', 'BD', 'TDS', 'QID', 'SOS', 'HS']),
  durationDays: z.number(),
  instructionsNp: z.string().nullable(),
});

export const visitDtoSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  providerUserId: z.string(),
  providerName: z.string(),
  facilityId: z.string().nullable(),
  facilityName: z.string().nullable(),
  visitAt: z.string(),
  chiefComplaintCode: z.string(),
  vitals: z.record(z.string(), z.unknown()),
  diagnosisCodes: z.array(z.string()),
  notes: z.string().nullable(),
  advice: z.string().nullable(),
  followUpAt: z.string().nullable(),
  referral: z.record(z.string(), z.unknown()).nullable(),
  prescriptions: z.array(prescriptionDtoSchema),
  supersedesId: z.string().nullable(),
  version: z.number(),
  updatedAt: z.string(),
  deleted: z.boolean(),
});

export const visitWrapperResponseSchema = z.object({ visit: visitDtoSchema });
export const visitListResponseSchema = z.object({ items: z.array(visitDtoSchema) });
