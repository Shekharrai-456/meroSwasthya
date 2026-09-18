import { errors as joseErrors, jwtVerify, SignJWT } from 'jose';
import type { Role } from '../../generated/prisma/enums.js';
import { config } from '../config.js';
import { AppError, ErrorCode } from './errors.js';

// docs/API_CONTRACT.md §2 / docs/SECURITY.md row 4 (REQ-AUTH-010, REQ-ROLE-008).
// Access and temp tokens share JWT_SECRET; grant tokens (Session 5) use the
// separate GRANT_SECRET - never interchangeable: `typ` is checked on every
// verify, and `algorithms: ['HS256']` is passed explicitly so jose rejects
// `alg:"none"` or any other algorithm outright.
const JWT_SECRET = new TextEncoder().encode(config.JWT_SECRET);
const GRANT_SECRET = new TextEncoder().encode(config.GRANT_SECRET);

// Fixed by backend.md §7.1 step 2 - not configurable, unlike ACCESS_TOKEN_TTL/
// REFRESH_TOKEN_TTL which vary by deployment.
const TEMP_TOKEN_TTL = '10m';

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  fid: string | null;
  typ: 'access';
}

export interface TempTokenPayload {
  // The temp token is issued right after OTP verification, before a User row
  // necessarily exists (a brand-new phone has no userId yet) - so `sub` here
  // is the verified phone number, not a userId. This is a deliberate reading
  // of backend.md §7.2's generic "sub: userId" wording, which describes the
  // access token; the temp token's own step (§7.1 step 2) never states what
  // `sub` holds for a possibly-nonexistent user. Documented in docs/PROGRESS.md.
  sub: string;
  typ: 'temp';
}

export async function signAccessToken(user: {
  id: string;
  role: Role;
  facilityId: string | null;
}): Promise<string> {
  return new SignJWT({ role: user.role, fid: user.facilityId, typ: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(config.ACCESS_TOKEN_TTL)
    .sign(JWT_SECRET);
}

export async function signTempToken(phone: string): Promise<string> {
  return new SignJWT({ typ: 'temp' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(phone)
    .setIssuedAt()
    .setExpirationTime(TEMP_TOKEN_TTL)
    .sign(JWT_SECRET);
}

async function verifyTyped<T extends { typ: string }>(
  token: string,
  expectedTyp: string,
): Promise<T> {
  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(token, JWT_SECRET, { algorithms: ['HS256'] });
    payload = result.payload;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Token expired');
    }
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Invalid token');
  }

  if (payload.typ !== expectedTyp) {
    // Wrong-token-type presented (e.g. a temp token on an access-only route,
    // or vice versa) - REQ-ROLE-008: never interchangeable.
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Invalid token type');
  }
  if (typeof payload.sub !== 'string') {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Invalid token');
  }
  return payload as unknown as T;
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  return verifyTyped<AccessTokenPayload>(token, 'access');
}

export async function verifyTempToken(token: string): Promise<TempTokenPayload> {
  return verifyTyped<TempTokenPayload>(token, 'temp');
}

// REQ-GRANT-001/002. Grant tokens have no `sub` claim (backend.md §7.2's
// literal claim list is {typ, gid, pid, scope, exp} - unlike access/temp
// tokens, there's no user identity being asserted, just "this specific grant
// row, for this patient, with this scope") - verifyTyped's `sub` requirement
// doesn't apply, so this is a separate, parallel verify path rather than a
// call to verifyTyped.
export interface GrantTokenPayload {
  typ: 'grant';
  gid: string;
  pid: string;
  scope: string;
}

export async function signGrantToken(
  input: { gid: string; pid: string; scope: string },
  ttlMinutes: number,
): Promise<string> {
  return new SignJWT({ typ: 'grant', gid: input.gid, pid: input.pid, scope: input.scope })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttlMinutes}m`)
    .sign(GRANT_SECRET);
}

// Every failure mode (expired, malformed, tampered signature, wrong secret)
// maps to the same GRANT_EXPIRED code - docs/API_CONTRACT.md's error table
// only defines one code for "this grant token isn't usable", and not
// distinguishing "tampered" from "expired" in the response is itself a
// defensible security choice (no extra information handed to an attacker
// probing what's wrong with a forged token).
export async function verifyGrantToken(token: string): Promise<GrantTokenPayload> {
  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(token, GRANT_SECRET, { algorithms: ['HS256'] });
    payload = result.payload;
  } catch {
    throw new AppError(ErrorCode.GRANT_EXPIRED, 'Grant token is invalid or expired');
  }
  if (
    payload.typ !== 'grant' ||
    typeof payload.gid !== 'string' ||
    typeof payload.pid !== 'string' ||
    typeof payload.scope !== 'string'
  ) {
    throw new AppError(ErrorCode.GRANT_EXPIRED, 'Grant token is invalid or expired');
  }
  return payload as unknown as GrantTokenPayload;
}
