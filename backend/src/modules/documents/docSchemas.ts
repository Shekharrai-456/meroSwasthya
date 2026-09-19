import { z } from 'zod';

export const documentDtoSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  uploadedByUserId: z.string(),
  type: z.enum(['prescription', 'lab', 'discharge', 'referral', 'other']),
  title: z.string(),
  takenAt: z.string(),
  status: z.enum(['pending_upload', 'uploaded']),
  downloadUrl: z.string().nullable(),
  aiSummary: z.string().nullable(),
  aiSummaryStatus: z.enum(['none', 'queued', 'done', 'failed']),
  version: z.number(),
  updatedAt: z.string(),
  deleted: z.boolean(),
});

export const documentPresignResponseSchema = z.object({
  document: documentDtoSchema,
  uploadUrl: z.string(),
  uploadMethod: z.literal('PUT'),
  uploadHeaders: z.record(z.string(), z.string()),
  expiresInSec: z.number(),
});

export const documentWrapperResponseSchema = z.object({ document: documentDtoSchema });
