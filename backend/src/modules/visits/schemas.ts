import { z } from 'zod';

// Mirrors backend.md A.2's Visit/Prescription shapes exactly (REQ-VISIT-009).
// Same self-contained-per-module discipline as patients/schemas.ts's own
// comment: not shared with patients/schemas.ts even where a shape overlaps.

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

// visitAt is a client-clock ISO timestamp (backend.md A.2: "when the
// encounter happened (client clock)") - validated as "parses to a real
// instant" rather than against a specific zod datetime format, so a client
// clock with or without milliseconds/offset is still accepted.
const isoDateTimeSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Must be a valid ISO 8601 datetime');

const vitalsSchema = z
  .object({
    bpSys: z.number().int().optional(),
    bpDia: z.number().int().optional(),
    pulse: z.number().int().optional(),
    tempC: z.number().optional(),
    weightKg: z.number().optional(),
    spo2: z.number().int().optional(),
  })
  .default({});

const referralSchema = z
  .object({
    facilityId: z.string().optional(),
    facilityName: z.string(),
    reason: z.string(),
    urgency: z.enum(['routine', 'urgent']),
  })
  .nullable()
  .optional();

const prescriptionSchema = z.object({
  id: z.string(),
  drugCode: z.string(),
  drugName: z.string(),
  dose: z.string(),
  frequency: z.enum(['OD', 'BD', 'TDS', 'QID', 'SOS', 'HS']),
  durationDays: z.number().int().positive(),
  instructionsNp: z.string().nullable().optional(),
});

// REQ-VISIT-001/002/009: id is client-generated (offline-first). providerUserId/
// providerName/facility are server-filled (REQ-VISIT-003) and deliberately
// absent from this schema - never accepted from the request body.
export const visitCreateSchema = z.object({
  id: z.uuid(),
  visitAt: isoDateTimeSchema,
  chiefComplaintCode: z.string().min(1, 'chiefComplaintCode is required'),
  vitals: vitalsSchema,
  diagnosisCodes: z.array(z.string()).default([]),
  notes: z.string().max(1000).nullable().optional(),
  advice: z.string().nullable().optional(),
  followUpAt: dateOnlySchema.nullable().optional(),
  referral: referralSchema,
  prescriptions: z.array(prescriptionSchema).default([]),
  supersedesId: z.uuid().nullable().optional(),
});
export type VisitCreateInput = z.infer<typeof visitCreateSchema>;

// REQ-VISIT-007: "limit 50" is the documented default; capped at 200 (the
// largest page size anywhere in this contract, docs/API_CONTRACT.md's sync
// pull) as a defensive bound rather than leaving the list truly unbounded.
export const visitListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
});
export type VisitListQuery = z.infer<typeof visitListQuerySchema>;
