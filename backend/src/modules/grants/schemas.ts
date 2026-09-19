import { z } from 'zod';

// Session 8 security-review finding: `ttlMinutes` had no upper bound, so a
// caller could mint an ordinary (Tier-1, no-PIN-at-redeem) QR grant valid for
// months or years - exactly the "printed long-lived QR" feature backend.md
// A.7 describes as Tier 2, gated on an *additional* PIN check at redeem
// (REQ-GRANT-012) precisely because a long-lived unprotected grant is a real
// risk (a lost/photographed QR would stay redeemable indefinitely). Capped
// at 60 minutes here - generous for real-world scanning, far short of
// anything that needs that extra safeguard. Revisit this cap if REQ-GRANT-012
// is ever built and needs to bypass it deliberately.
const GRANT_TTL_MINUTES_MAX = 60;

// REQ-GRANT-001.
export const grantCreateSchema = z.object({
  patientId: z.uuid(),
  scope: z.enum(['read', 'append']),
  ttlMinutes: z.number().int().positive().max(GRANT_TTL_MINUTES_MAX).optional(),
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
