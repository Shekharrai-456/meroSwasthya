import { prisma } from '../../lib/prisma.js';
import { haversineKm } from '../../lib/geo.js';
import { type FacilityDto, toFacilityDto } from '../../lib/serializers.js';
import type { FacilitiesNearbyQuery } from './schemas.js';

// REQ-FACILITY-001: Haversine distance, optional hasBirthingCentre filter,
// sorted, limited. The dataset is small by design (a handful of facilities
// per district, per backend.md §10) - computed and sorted in memory rather
// than in SQL, same tradeoff backend.md itself calls out ("Haversine in SQL
// or in memory (≤ 200 rows)").
export async function listNearbyFacilities(query: FacilitiesNearbyQuery): Promise<FacilityDto[]> {
  const facilities = await prisma.facility.findMany({
    where: query.birthing ? { hasBirthingCentre: true } : undefined,
  });

  return facilities
    .map((facility) => ({
      facility,
      distanceKm: haversineKm({ lat: query.lat, lng: query.lng }, facility),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, query.limit)
    .map(({ facility, distanceKm }) => toFacilityDto(facility, distanceKm));
}
