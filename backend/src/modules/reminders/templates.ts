import { toBsDateString } from '../../lib/bsDate.js';

// REQ-REMIND-004: bilingual templates with a BS date. The single source of
// truth for every reminder kind's message text - src/modules/visits/service.ts
// (follow_up) and src/modules/maternal/service.ts (anc_due/anc_missed)
// previously built minimal inline messages without a BS date (documented at
// the time as "Phase 8 will replace this"); both now call these instead.

function formatBoth(adDateOnly: string): string {
  const bs = toBsDateString(new Date(adDateOnly));
  return `${bs} (${adDateOnly})`;
}

export function buildFollowUpMessages(
  patientName: string,
  followUpAt: string,
): { np: string; en: string } {
  const when = formatBoth(followUpAt);
  return {
    np: `${patientName} को पुन: जाँच मिति ${when} मा तोकिएको छ। कृपया समयमा स्वास्थ्य संस्था जानुहोस्।`,
    en: `Follow-up visit for ${patientName} is due on ${when}. Please visit the health facility on time.`,
  };
}

export function buildAncDueMessages(
  patientName: string,
  contactNo: number,
  weekTarget: number,
  dueAt: string,
): { np: string; en: string } {
  const when = formatBoth(dueAt);
  return {
    np: `${patientName} को गर्भ जाँच ${contactNo} (हप्ता ${weekTarget}) मिति ${when} मा तोकिएको छ। कृपया नजिकको स्वास्थ्य संस्थामा जानुहोस्।`,
    en: `${patientName}'s ANC contact ${contactNo} (week ${weekTarget}) is due on ${when}. Please visit your health facility.`,
  };
}

export function buildAncMissedMessages(
  patientName: string,
  contactNo: number,
  dueAt: string,
): { np: string; en: string } {
  const when = formatBoth(dueAt);
  return {
    np: `${patientName} को गर्भ जाँच ${contactNo} मिति ${when} मा हुनुपर्थ्यो तर अझै भएको छैन। कृपया चाँडै स्वास्थ्य संस्थामा सम्पर्क गर्नुहोस्।`,
    en: `${patientName}'s ANC contact ${contactNo} was due on ${when} and hasn't been completed yet. Please visit as soon as possible.`,
  };
}
