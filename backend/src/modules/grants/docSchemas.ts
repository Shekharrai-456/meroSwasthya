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
  printed: z.boolean(),
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

// REQ-GRANT-007. Small entity shapes duplicated here rather than imported
// from patients/maternal's own docSchemas.ts - same self-contained-per-module
// discipline as patientDtoSchema above (already duplicated from
// patients/docSchemas.ts).

const ancContactDtoSchema = z.object({
  id: z.string(),
  pregnancyId: z.string(),
  contactNo: z.number(),
  weekTarget: z.number(),
  dueAt: z.string(),
  doneAt: z.string().nullable(),
  providerUserId: z.string().nullable(),
  findings: z.record(z.string(), z.unknown()).nullable(),
  dangerSigns: z.array(z.string()),
  triageLevel: z.enum(['green', 'amber', 'red']).nullable(),
  triageReasons: z.array(z.string()),
  referral: z.record(z.string(), z.unknown()).nullable(),
  version: z.number(),
  updatedAt: z.string(),
  deleted: z.boolean(),
});

const pregnancyDtoSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  lmp: z.string().nullable(),
  edd: z.string(),
  gravida: z.number(),
  para: z.number(),
  riskFactors: z.array(z.string()),
  riskLevel: z.enum(['normal', 'high']),
  status: z.enum(['active', 'delivered', 'ended']),
  birthPlan: z.record(z.string(), z.unknown()).nullable(),
  registeredByUserId: z.string(),
  gestationalAgeDays: z.number(),
  nextContact: ancContactDtoSchema.nullable(),
  version: z.number(),
  updatedAt: z.string(),
  deleted: z.boolean(),
});

const prescriptionDtoSchema = z.object({
  id: z.string(),
  drugCode: z.string(),
  drugName: z.string(),
  dose: z.string(),
  frequency: z.enum(['OD', 'BD', 'TDS', 'QID', 'SOS', 'HS']),
  durationDays: z.number(),
  instructionsNp: z.string().nullable(),
});

const activeProblemDtoSchema = z.object({
  code: z.string(),
  labelEn: z.string(),
  labelNp: z.string(),
  since: z.string().nullable(),
});

const patientSummaryDtoSchema = z.object({
  activeProblems: z.array(activeProblemDtoSchema),
  currentMedicines: z.array(prescriptionDtoSchema),
  allergies: z.array(z.string()),
  lastVitals: z.record(z.string(), z.unknown()).nullable(),
  activePregnancy: pregnancyDtoSchema.nullable(),
  lastVisitAt: z.string().nullable(),
  visitCount: z.number(),
});

const timelineItemDtoSchema = z.object({
  kind: z.enum(['visit', 'document', 'pregnancy_registered', 'anc_contact', 'delivery']),
  at: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  badge: z.enum(['green', 'amber', 'red']).nullable(),
  refId: z.string(),
  payload: z.unknown(),
});

export const grantRedeemResponseSchema = z.object({
  grant: grantDtoSchema,
  patient: patientDtoSchema,
  summary: patientSummaryDtoSchema,
  timeline: z.array(timelineItemDtoSchema),
  pregnancy: pregnancyDtoSchema.nullable(),
  ancContacts: z.array(ancContactDtoSchema),
});

export const grantRevokeResponseSchema = z.object({
  grant: grantDtoSchema,
});
