import { z } from 'zod';

export const facilityDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['health_post', 'phcc', 'hospital', 'birthing_centre']),
  hasBirthingCentre: z.boolean(),
  phone: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  municipality: z.string(),
  distanceKm: z.number().nullable(),
});

export const facilitiesNearbyResponseSchema = z.object({ items: z.array(facilityDtoSchema) });
