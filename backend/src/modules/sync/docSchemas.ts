import { z } from 'zod';

// Documentation-only shapes (docs/openapi.json) - `row`/`current`/`payload`
// are intentionally loose (`z.unknown()`): their real shape is whichever
// entity's own DTO the `table` field names, already fully documented by
// that entity's own module.

export const syncResultSchema = z.object({
  opId: z.string(),
  status: z.enum(['applied', 'duplicate', 'conflict', 'rejected']),
  row: z.unknown().optional(),
  current: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

export const syncPushResponseSchema = z.object({
  results: z.array(syncResultSchema),
  serverTime: z.string(),
});

export const syncPullResponseSchema = z.object({
  changes: z.array(z.object({ table: z.string(), row: z.unknown() })),
  cursor: z.string(),
  hasMore: z.boolean(),
});
