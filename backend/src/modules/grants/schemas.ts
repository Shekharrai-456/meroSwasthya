import { z } from 'zod';

// REQ-GRANT-001.
export const grantCreateSchema = z.object({
  patientId: z.uuid(),
  scope: z.enum(['read', 'append']),
  ttlMinutes: z.number().int().positive().optional(),
});
export type GrantCreateInput = z.infer<typeof grantCreateSchema>;

// REQ-GRANT-002/003: the "SWC1:" prefix is the version marker - a future
// format change bumps to "SWC2:" rather than silently reinterpreting the
// same prefix, so this is checked here, not left to jose to reject as an
// unparseable token.
export const grantRedeemSchema = z.object({
  qrPayload: z.string().regex(/^SWC1:.+$/, 'qrPayload must start with "SWC1:"'),
});
export type GrantRedeemInput = z.infer<typeof grantRedeemSchema>;
