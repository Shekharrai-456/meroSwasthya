import { z } from 'zod';

// REQ-SYNC-001..008. `table` is restricted to the 5 syncable tables that
// actually exist in this build - `documents` is part of Part A's documented
// contract but Documents (Phase 9) doesn't exist yet, so a change targeting
// it fails this enum and comes back `rejected VALIDATION_ERROR` (a correct,
// if incidental, fit with REQ-SYNC-008's rejection categories - there is
// nothing to authorize or apply it against).
export const SYNCABLE_TABLES = [
  'patients',
  'visits',
  'pregnancies',
  'anc_contacts',
  'deliveries',
] as const;
export type SyncableTable = (typeof SYNCABLE_TABLES)[number];

export const syncChangeSchema = z.object({
  opId: z.string().min(1),
  table: z.enum(SYNCABLE_TABLES),
  op: z.literal('upsert'),
  rowId: z.string().min(1),
  baseVersion: z.number().int().nonnegative(),
  payload: z.record(z.string(), z.unknown()),
});
export type SyncChangeInput = z.infer<typeof syncChangeSchema>;

// REQ-SYNC-001: max 50 changes per push.
export const syncPushSchema = z.object({
  deviceId: z.string().min(1),
  changes: z.array(syncChangeSchema).max(50),
});
export type SyncPushInput = z.infer<typeof syncPushSchema>;

export const syncPullQuerySchema = z.object({
  since: z.string().optional(),
  deviceId: z.string().min(1),
});
export type SyncPullQuery = z.infer<typeof syncPullQuerySchema>;
