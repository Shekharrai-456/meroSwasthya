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

// Session 6 frontend-contract audit finding: backend.md's own A.4 examples
// wrap every single-patient response as { "patient": <Patient> } (POST
// /patients, GET /patients/:id, PATCH /patients/:id) - the routes
// previously returned the bare patient object instead, which would have
// broken any real frontend expecting `data.patient.id`. Fixed here and in
// routes.ts together; see docs/PROGRESS.md's Session 6 entry.
export const patientWrapperResponseSchema = z.object({
  patient: patientDtoSchema,
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

// Documentation-only shapes for the summary/timeline blocks
// (REQ-PATIENT-005..009). Small entity shapes (Pregnancy, AncContact) are
// duplicated here rather than imported from maternal/docSchemas.ts, same
// self-contained-per-module discipline as every other module's docSchemas.ts
// (patientDtoSchema itself is already duplicated in grants/docSchemas.ts).

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

export const patientDetailResponseSchema = z.object({
  patient: patientDtoSchema,
  summary: patientSummaryDtoSchema,
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

export const timelineResponseSchema = z.object({
  items: z.array(timelineItemDtoSchema),
  nextBefore: z.string().nullable(),
});
