import { z } from 'zod';

// REQ-FACILITY-001. `birthing` is a query-string boolean - only the literal
// "true" filters to birthing-centre facilities; anything else (including
// omitted) means "no filter, show all" (z.coerce.boolean() would be wrong
// here since Boolean("false") is true in JS).
export const facilitiesNearbyQuerySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  birthing: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  limit: z.coerce.number().int().positive().max(50).optional().default(10),
});
export type FacilitiesNearbyQuery = z.infer<typeof facilitiesNearbyQuerySchema>;
