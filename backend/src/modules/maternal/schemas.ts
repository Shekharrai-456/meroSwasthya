import { z } from 'zod';

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const isoDateTimeSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Must be a valid ISO 8601 datetime');

const birthPlanSchema = z
  .object({
    facilityId: z.string().optional(),
    facilityName: z.string().optional(),
    transport: z.string().optional(),
    moneySaved: z.boolean().optional(),
    bloodDonorName: z.string().optional(),
    bloodDonorPhone: z.string().optional(),
    companionName: z.string().optional(),
  })
  .nullable()
  .optional();

// REQ-PREG-001/003: id is client-generated (offline-first). "Either lmp or
// edd must be given" (backend.md A.2) - enforced with a top-level refine
// rather than making both required, since exactly one is the documented
// entry path (LMP known, or EDD known from an ultrasound).
export const pregnancyCreateSchema = z
  .object({
    id: z.uuid(),
    lmp: dateOnlySchema.nullable().optional(),
    edd: dateOnlySchema.nullable().optional(),
    gravida: z.number().int().positive(),
    para: z.number().int().nonnegative(),
    riskFactors: z.array(z.string()).default([]),
    birthPlan: birthPlanSchema,
  })
  .refine((value) => Boolean(value.lmp) || Boolean(value.edd), {
    message: 'Either lmp or edd must be given',
    path: ['lmp'],
  });
export type PregnancyCreateInput = z.infer<typeof pregnancyCreateSchema>;

// REQ-PREG-009: version required (optimistic concurrency); every other
// field is a partial update. `status` may only ever be set to "ended" here -
// "active"/"delivered" are server-assigned transitions (creation,
// POST .../delivery), never a direct client PATCH target.
export const pregnancyUpdateSchema = z.object({
  version: z.number().int().positive(),
  birthPlan: birthPlanSchema,
  riskFactors: z.array(z.string()).optional(),
  status: z.literal('ended').optional(),
});
export type PregnancyUpdateInput = z.infer<typeof pregnancyUpdateSchema>;

const findingsSchema = z
  .object({
    weightKg: z.number().optional(),
    bpSys: z.number().int().optional(),
    bpDia: z.number().int().optional(),
    fundalHeightCm: z.number().optional(),
    fhrBpm: z.number().int().optional(),
    hbGdl: z.number().optional(),
    urineProtein: z.enum(['neg', 'trace', '+', '++', '+++']).optional(),
    tdDoseGiven: z.boolean().optional(),
    ifaGiven: z.boolean().optional(),
    dewormingGiven: z.boolean().optional(),
    calciumGiven: z.boolean().optional(),
    fetalMovement: z.enum(['normal', 'reduced', 'absent']).optional(),
  })
  .nullable()
  .optional();

const referralSchema = z
  .object({
    facilityId: z.string().optional(),
    facilityName: z.string(),
    reason: z.string(),
    urgency: z.enum(['routine', 'urgent']),
  })
  .nullable()
  .optional();

// REQ-PREG-010/011: contactNo comes from the route param, not the body.
export const contactRecordSchema = z.object({
  doneAt: isoDateTimeSchema,
  findings: findingsSchema,
  dangerSigns: z.array(z.string()).default([]),
  referral: referralSchema,
});
export type ContactRecordInput = z.infer<typeof contactRecordSchema>;

export const contactNoParamsSchema = z.object({
  id: z.uuid(),
  contactNo: z.coerce.number().int().min(1).max(8),
});

// REQ-PREG-015: id is client-generated, matching Visit's own precedent.
export const deliveryCreateSchema = z.object({
  id: z.uuid(),
  deliveredAt: isoDateTimeSchema,
  place: z.enum(['home', 'birthing_centre', 'hospital', 'on_the_way']),
  mode: z.enum(['normal', 'assisted', 'cs']),
  outcome: z.enum(['live_birth', 'stillbirth']),
  babyWeightKg: z.number().positive().nullable().optional(),
  babySex: z.enum(['female', 'male', 'other']).nullable().optional(),
  complications: z.array(z.string()).default([]),
});
export type DeliveryCreateInput = z.infer<typeof deliveryCreateSchema>;
