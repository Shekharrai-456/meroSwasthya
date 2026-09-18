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

// Parses the small subset of duration strings this codebase's config actually
// uses (REFRESH_TOKEN_TTL="30d", etc. - config.ts's own zod schema is the
// source of truth for which keys exist). Not a general-purpose duration
// parser: jose's setExpirationTime() already handles JWT `exp` claims
// natively, this is only needed for raw DB timestamps like
// RefreshToken.expiresAt.
const DURATION_UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function addDuration(base: Date, human: string): Date {
  const match = /^(\d+)(s|m|h|d)$/.exec(human);
  if (!match?.[1] || !match[2]) {
    throw new Error(`Unsupported duration format: "${human}"`);
  }
  const amount = Number(match[1]);
  const unitMs = DURATION_UNIT_MS[match[2]];
  if (unitMs === undefined) {
    throw new Error(`Unsupported duration unit: "${match[2]}"`);
  }
  return new Date(base.getTime() + amount * unitMs);
}
