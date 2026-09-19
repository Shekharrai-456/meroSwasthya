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

// REQ-GRANT-012 (Tier 2): the printed fallback card's own token lifetime
// (backend.md A.7's "ttlMinutes = 525600" = 1 year) - a server-set constant,
// never accepted from the request body, so `printed: true` deliberately
// cannot be combined with a client-supplied `ttlMinutes` (see the `.refine()`
// below) - that would reopen exactly the gap the 60-minute cap above closes.
export const PRINTED_GRANT_TTL_MINUTES = 525_600;

// REQ-GRANT-001/012. `scope` is required unless `printed` is true (the
// printed card is always `scope:"read"`, forced server-side); `ttlMinutes`
// is rejected outright when `printed` is true, for the same reason.
export const grantCreateSchema = z
  .object({
    patientId: z.uuid(),
    scope: z.enum(['read', 'append']).optional(),
    ttlMinutes: z.number().int().positive().max(GRANT_TTL_MINUTES_MAX).optional(),
    printed: z.boolean().optional().default(false),
  })
  .refine((value) => value.printed || value.scope !== undefined, {
    message: 'scope is required unless printed is true',
    path: ['scope'],
  })
  .refine((value) => !value.printed || value.ttlMinutes === undefined, {
    message: 'ttlMinutes cannot be set when printed is true (the server forces a 1-year TTL)',
    path: ['ttlMinutes'],
  });
export type GrantCreateInput = z.infer<typeof grantCreateSchema>;

// REQ-GRANT-002/003/012: the "SWC1:" prefix is the version marker - a future
// format change bumps to "SWC2:" rather than silently reinterpreting the
// same prefix, so this is checked here, not left to jose to reject as an
// unparseable token. `pin` is only required when the redeemed grant turns
// out to be a printed one (checked in grants/service.ts, since the schema
// has no way to know the grant's `printed` flag before decoding the token).
export const grantRedeemSchema = z.object({
  qrPayload: z.string().regex(/^SWC1:.+$/, 'qrPayload must start with "SWC1:"'),
  pin: z
    .string()
    .regex(/^\d{4}$/, 'PIN must be 4 digits')
    .optional(),
});
export type GrantRedeemInput = z.infer<typeof grantRedeemSchema>;
