import DateConverter from '@remotemerge/nepali-date-converter';

// REQ-REMIND-004: reminder message templates need a BS date
// (docs/TECH_DECISIONS.md's "Bikram Sambat date conversion" entry). The
// library converts AD -> {year, month, date, day} but has no Nepali
// month-name or Devanagari-numeral formatting - both are small, fixed
// lookup tables (they never change), not worth a second dependency for.

const BS_MONTH_NAMES_NP = [
  'बैशाख',
  'जेठ',
  'असार',
  'साउन',
  'भदौ',
  'असोज',
  'कार्तिक',
  'मंसिर',
  'पुष',
  'माघ',
  'फागुन',
  'चैत',
];

const DEVANAGARI_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];

function toDevanagariNumerals(value: number): string {
  return String(value)
    .split('')
    .map((digit) => DEVANAGARI_DIGITS[Number(digit)] ?? digit)
    .join('');
}

// Formats like frontend.md §13's own example: "२०८३ असोज २" (year, month
// name, day - the server never appends the AD date itself; callers that
// want both, like a reminder message, compose it themselves).
export function toBsDateString(date: Date): string {
  const dateOnly = date.toISOString().slice(0, 10);
  const bs = new DateConverter(dateOnly).toBs();
  const monthName = BS_MONTH_NAMES_NP[bs.month - 1] ?? String(bs.month);
  return `${toDevanagariNumerals(bs.year)} ${monthName} ${toDevanagariNumerals(bs.date)}`;
}
