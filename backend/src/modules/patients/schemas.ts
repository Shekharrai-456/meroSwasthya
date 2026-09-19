import { z } from 'zod';

// REQ-AUTH-001's phone shape, duplicated rather than imported from
// modules/auth/schemas.ts - each module's schemas.ts is self-contained per
// docs/ARCHITECTURE.md's directory tree, and this is a single-line regex,
// not enough duplication to justify a shared lib module this session.
const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, 'Phone must be in E.164 format, e.g. +9779801000001');

const sexSchema = z.enum(['female', 'male', 'other']);
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const stringArraySchema = z.array(z.string()).default([]);

// REQ-PATIENT-001/011: id is client-generated (offline-first) - the schema
// requires it rather than the server assigning one.
export const patientCreateSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, 'Name is required').max(200),
  sex: sexSchema,
  dob: dateOnlySchema,
  bloodGroup: z.string().max(10).nullable().optional(),
  ward: z.number().int().nullable().optional(),
  municipality: z.string().max(200).nullable().optional(),
  allergies: stringArraySchema,
  chronicConditions: stringArraySchema,
  emergencyContactPhone: phoneSchema.nullable().optional(),
});
export type PatientCreateInput = z.infer<typeof patientCreateSchema>;

// REQ-PATIENT-003: optimistic concurrency - version is required on every
// update, not optional. Every other field is a partial update.
export const patientUpdateSchema = z.object({
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(200).optional(),
  sex: sexSchema.optional(),
  dob: dateOnlySchema.optional(),
  bloodGroup: z.string().max(10).nullable().optional(),
  ward: z.number().int().nullable().optional(),
  municipality: z.string().max(200).nullable().optional(),
  allergies: z.array(z.string()).optional(),
  chronicConditions: z.array(z.string()).optional(),
  emergencyContactPhone: phoneSchema.nullable().optional(),
});
export type PatientUpdateInput = z.infer<typeof patientUpdateSchema>;

// REQ-PATIENT-008: "limit 50" is backend.md §9.1.2's literal cap - unlike
// Visits' `limit` (default 50, capped at 200), the timeline has no
// documented larger page size to allow.
export const timelineQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional().default(50),
  before: z.string().optional(),
});
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;
