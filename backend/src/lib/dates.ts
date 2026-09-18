// Date/timestamp conventions (docs/API_CONTRACT.md §on dates; REQ-API-008).
// Calendar dates are YYYY-MM-DD (AD only); timestamps are ISO 8601 UTC with ms.
// The server never stores or returns Bikram Sambat — that conversion is the
// frontend's job (nepali_utils), not this file's.

export function toIso(date: Date): string {
  return date.toISOString();
}

export function toDateOnly(date: Date): string {
  const iso = date.toISOString();
  const datePart = iso.slice(0, 10);
  return datePart;
}

export function now(): Date {
  return new Date();
}
