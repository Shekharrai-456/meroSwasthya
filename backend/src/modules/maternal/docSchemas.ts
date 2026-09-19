import { z } from 'zod';

// Documentation-only shapes (docs/openapi.json) - see lib/routeDocs.ts's
// noopValidatorCompiler/noopSerializerCompiler for why these can never
// desync from and corrupt a real response.

const findingsDtoSchema = z.record(z.string(), z.unknown()).nullable();
const referralDtoSchema = z.record(z.string(), z.unknown()).nullable();

export const ancContactDtoSchema = z.object({
  id: z.string(),
  pregnancyId: z.string(),
  contactNo: z.number(),
  weekTarget: z.number(),
  dueAt: z.string(),
  doneAt: z.string().nullable(),
  providerUserId: z.string().nullable(),
  findings: findingsDtoSchema,
  dangerSigns: z.array(z.string()),
  triageLevel: z.enum(['green', 'amber', 'red']).nullable(),
  triageReasons: z.array(z.string()),
  referral: referralDtoSchema,
  version: z.number(),
  updatedAt: z.string(),
  deleted: z.boolean(),
});

export const facilityDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['health_post', 'phcc', 'hospital', 'birthing_centre']),
  hasBirthingCentre: z.boolean(),
  phone: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  municipality: z.string(),
  distanceKm: z.number().nullable(),
});

export const deliveryDtoSchema = z.object({
  id: z.string(),
  pregnancyId: z.string(),
  deliveredAt: z.string(),
  place: z.enum(['home', 'birthing_centre', 'hospital', 'on_the_way']),
  mode: z.enum(['normal', 'assisted', 'cs']),
  outcome: z.enum(['live_birth', 'stillbirth']),
  babyWeightKg: z.number().nullable(),
  babySex: z.enum(['female', 'male', 'other']).nullable(),
  complications: z.array(z.string()),
  version: z.number(),
  updatedAt: z.string(),
  deleted: z.boolean(),
});

export const reminderDtoSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  pregnancyId: z.string().nullable(),
  kind: z.enum(['anc_due', 'anc_missed', 'follow_up', 'medicine']),
  dueAt: z.string(),
  channel: z.enum(['sms', 'push']),
  recipientPhone: z.string(),
  recipientRole: z.string(),
  messageNp: z.string(),
  messageEn: z.string(),
  status: z.enum(['pending', 'sent', 'failed', 'cancelled']),
  sentAt: z.string().nullable(),
});

export const pregnancyDtoSchema = z.object({
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

export const pregnancyCreateResponseSchema = z.object({
  pregnancy: pregnancyDtoSchema,
  ancContacts: z.array(ancContactDtoSchema),
});

export const pregnancyBundleResponseSchema = z.object({
  pregnancy: pregnancyDtoSchema,
  ancContacts: z.array(ancContactDtoSchema),
  delivery: deliveryDtoSchema.nullable(),
  reminders: z.array(reminderDtoSchema),
});

export const pregnancyWrapperResponseSchema = z.object({ pregnancy: pregnancyDtoSchema });

export const contactRecordResponseSchema = z.object({
  ancContact: ancContactDtoSchema,
  nearestReferral: facilityDtoSchema.nullable(),
});

export const deliveryResponseSchema = z.object({
  delivery: deliveryDtoSchema,
  pregnancy: pregnancyDtoSchema,
});
