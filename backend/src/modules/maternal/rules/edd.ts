import { addDaysToDateOnly } from '../../../lib/dates.js';

// Mirrors domain/rules/edd.dart line-for-line (frontend.md §12, backend.md
// §9.5). REQ-PREG-003/005/011. All dates are YYYY-MM-DD (AD) - the server
// never computes or returns Bikram Sambat.
const GESTATION_DAYS = 280;

// edd.dart: `eddFromLmp`.
export function eddFromLmp(lmpDateOnly: string): string {
  return addDaysToDateOnly(lmpDateOnly, GESTATION_DAYS);
}

// edd.dart: `lmpFromEdd`.
export function lmpFromEdd(eddDateOnly: string): string {
  return addDaysToDateOnly(eddDateOnly, -GESTATION_DAYS);
}

// edd.dart: `gestationalAgeDays` - whole calendar days between the LMP
// (derived from edd) and `today`.
export function gestationalAgeDays(eddDateOnly: string, today: Date): number {
  const lmp = lmpFromEdd(eddDateOnly);
  const [year, month, day] = lmp.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Invalid date-only string: "${lmp}"`);
  }
  const lmpMs = Date.UTC(year, month - 1, day);
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((todayMs - lmpMs) / 86_400_000);
}
