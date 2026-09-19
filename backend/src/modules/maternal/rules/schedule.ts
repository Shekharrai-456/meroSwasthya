import { ancContactId } from '../../../lib/ids.js';
import { lmpFromEdd } from './edd.js';
import rules from './rules.json' with { type: 'json' };

// Mirrors domain/rules/anc_schedule.dart's `generateContacts` (frontend.md
// §12, backend.md §9.5/A.5). REQ-PREG-004/005: 8 contacts per pregnancy,
// deterministic ids, dueAt = lmpFromEdd(edd) + weekTarget weeks.

export interface AncScheduleEntry {
  contactNo: number;
  weekTarget: number;
  checklist: string[];
}

export const ancSchedule: AncScheduleEntry[] = rules.ancSchedule;

export interface GeneratedContact {
  id: string;
  contactNo: number;
  weekTarget: number;
  dueAt: string;
}

export function generateContactSchedule(pregnancyId: string, edd: string): GeneratedContact[] {
  const lmp = lmpFromEdd(edd);
  const [year, month, day] = lmp.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Invalid date-only string: "${lmp}"`);
  }
  return ancSchedule.map((entry) => {
    const dueDate = new Date(Date.UTC(year, month - 1, day + entry.weekTarget * 7));
    return {
      id: ancContactId(pregnancyId, entry.contactNo),
      contactNo: entry.contactNo,
      weekTarget: entry.weekTarget,
      dueAt: dueDate.toISOString().slice(0, 10),
    };
  });
}
