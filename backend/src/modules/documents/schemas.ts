import { z } from 'zod';

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

// REQ-DOC-001. contentType is restricted to "image/jpeg" only - Question 3
// (docs/OPEN_QUESTIONS.md), not the PNG-inclusive list backend.md's literal
// text names, since the object key is hard-coded `.jpg` regardless and the
// frontend's only documented capture path already compresses to JPEG.
const MAX_SIZE_BYTES = 2 * 1024 * 1024;

export const documentPresignSchema = z.object({
  id: z.uuid(),
  patientId: z.uuid(),
  type: z.enum(['prescription', 'lab', 'discharge', 'referral', 'other']),
  title: z.string().trim().min(1, 'Title is required').max(200),
  takenAt: dateOnlySchema,
  contentType: z.literal('image/jpeg', { message: 'Only image/jpeg is accepted' }),
  sizeBytes: z.number().int().positive().max(MAX_SIZE_BYTES, 'File exceeds 2 MB'),
});
export type DocumentPresignInput = z.infer<typeof documentPresignSchema>;

// REQ-SYNC-003: documents are syncable "meta only" - version required
// (optimistic concurrency), never `status`/`objectKey`/`aiSummary*`.
export const documentMetadataUpdateSchema = z.object({
  version: z.number().int().positive(),
  type: z.enum(['prescription', 'lab', 'discharge', 'referral', 'other']).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  takenAt: dateOnlySchema.optional(),
});
export type DocumentMetadataUpdateInput = z.infer<typeof documentMetadataUpdateSchema>;
