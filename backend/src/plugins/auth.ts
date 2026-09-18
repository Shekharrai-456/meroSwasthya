import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '../../generated/prisma/enums.js';
import { AppError, ErrorCode } from '../lib/errors.js';
import { verifyAccessToken, verifyTempToken } from '../lib/tokens.js';

// docs/ARCHITECTURE.md §1/§3, REQ-ROLE-002/008. Two genuinely different
// mechanisms, kept separate on purpose:
//   - requireAuth/requireRole: WHO the caller is (role-based access control).
//   - canReadPatient/canAppendPatient (object-level ownership): WHICH record
//     they may touch. Those live in Phase 3/4 (src/modules/patients,
//     src/modules/grants) because they query the Patient/AccessGrant tables,
//     which don't exist yet - see docs/PROGRESS.md's Session 3 entry for why
//     REQ-ROLE-003/004/005/006/007 are deliberately not built here.

export interface AuthenticatedUser {
  id: string;
  role: Role;
  facilityId: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
    // Set by requireTemp: the phone number a tempToken was issued for
    // (lib/tokens.ts - tempToken.sub is a phone, not a userId, since the user
    // may not exist yet at OTP-verify time).
    tempPhone?: string;
  }
}

function extractBearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Missing bearer token');
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Missing bearer token');
  }
  return token;
}

// REQ-AUTH-012: 401 UNAUTHENTICATED for missing/invalid/expired/wrong-type
// tokens - verifyAccessToken already throws AppError for every failure mode,
// this only adds the "missing header" case and attaches request.user.
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = extractBearerToken(request);
  const payload = await verifyAccessToken(token);
  request.user = { id: payload.sub, role: payload.role, facilityId: payload.fid };
}

// REQ-AUTH-005: gates POST /auth/pin/set. Must run instead of, never in
// addition to, requireAuth - a temp token is never a valid access token
// (REQ-ROLE-008).
export async function requireTemp(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = extractBearerToken(request);
  const payload = await verifyTempToken(token);
  request.tempPhone = payload.sub;
}

// Routes gated by requireAuth/requireRole can rely on request.user being set
// by the time their handler runs, but reading it via a non-null assertion is
// forbidden by this project's lint config (style/noNonNullAssertion) - this
// is the one sanctioned place that invariant is asserted, with a real runtime
// check (and a real error) backing it instead of a silent `!`.
export function getAuthenticatedUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.user) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Missing bearer token');
  }
  return request.user;
}

// Same pattern for requireTemp - used by POST /auth/pin/set.
export function getTempPhone(request: FastifyRequest): string {
  if (!request.tempPhone) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Missing bearer token');
  }
  return request.tempPhone;
}

// REQ-ROLE-002: reusable role-check dependency, composed after requireAuth in
// a route's preHandler chain (never conflated with it - see module comment).
export function requireRole(...roles: Role[]) {
  return async function roleCheck(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (!request.user) {
      // Defensive: only reachable if a route wires requireRole without
      // requireAuth first, which is a programming error, not a client one.
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Missing bearer token');
    }
    if (!roles.includes(request.user.role)) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Role not allowed for this endpoint');
    }
  };
}
