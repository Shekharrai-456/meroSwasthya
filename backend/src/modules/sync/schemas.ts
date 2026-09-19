import { z } from 'zod';

// REQ-SYNC-001..008. `documents` was added in Session 13 once the Documents
// module existed - see sync/service.ts's `applyDocumentChange` for why it's
// update-only (metadata fields, never `status`), not full create+upload:
// a presigned upload URL's 15-minute TTL is fundamentally incompatible with
// outbox-style store-and-forward queuing, so document creation always goes
// through the real-time `POST /documents/presign` REST call
// (REQ-SYNC-019's own documented "presign -> PUT bytes -> complete"
// sequence), never sync.
export const SYNCABLE_TABLES = [
  'patients',
  'visits',
  'pregnancies',
  'anc_contacts',
  'deliveries',
  'documents',
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
