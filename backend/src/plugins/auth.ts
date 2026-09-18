import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuditAction, GrantScope, Role } from '../../generated/prisma/enums.js';
import { AppError, ErrorCode } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { verifyAccessToken, verifyTempToken } from '../lib/tokens.js';
import { logAudit, wasRecentlyViewed } from '../modules/audit/service.js';

// docs/ARCHITECTURE.md §1/§3, REQ-ROLE-002/008. Two genuinely different
// mechanisms, kept separate on purpose:
//   - requireAuth/requireRole: WHO the caller is (role-based access control).
//   - canReadPatient/canAppendPatient (object-level ownership): WHICH record
//     they may touch.
//
// canReadPatient/canAppendPatient (REQ-ROLE-003/004) were deferred from
// Session 3 because they need the Patient/AccessGrant tables - both now
// exist (Session 4, Phase 3). REQ-ROLE-005 (fchv blocked from visits) still
// can't be built here: it depends on the Visits module (Phase 5), which
// doesn't exist yet.

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

// REQ-ROLE-003. Patient rows are never hard-checked for existence here - a
// nonexistent/soft-deleted patient simply has no owner match and no grant
// match, so this returns false exactly as if access were denied. Callers
// that need to distinguish "doesn't exist" (404) from "exists, no access"
// (403) - every route in modules/patients/routes.ts - check existence first.
async function isOwner(actorUserId: string, patientId: string): Promise<boolean> {
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, deleted: false, ownerUserId: actorUserId },
    select: { id: true },
  });
  return patient !== null;
}

async function hasActiveGrant(
  actorUserId: string,
  patientId: string,
  requiredScope?: GrantScope,
): Promise<boolean> {
  const grant = await prisma.accessGrant.findFirst({
    where: {
      patientId,
      redeemedByUserId: actorUserId,
      revokedAt: null,
      accessUntil: { gt: new Date() },
      ...(requiredScope ? { scope: requiredScope } : {}),
    },
    select: { id: true },
  });
  return grant !== null;
}

export async function canReadPatient(
  actor: AuthenticatedUser,
  patientId: string,
): Promise<boolean> {
  if (await isOwner(actor.id, patientId)) {
    return true;
  }
  return hasActiveGrant(actor.id, patientId);
}

// REQ-ROLE-004: canReadPatient AND scope=append - owners always pass
// regardless of scope, since scope only constrains a *grant*, not ownership.
export async function canAppendPatient(
  actor: AuthenticatedUser,
  patientId: string,
): Promise<boolean> {
  if (await isOwner(actor.id, patientId)) {
    return true;
  }
  return hasActiveGrant(actor.id, patientId, GrantScope.append);
}

// REQ-ROLE-006: fetch only what the audit row's denormalised actorName/
// actorFacilityName fields need - never the full user row (avoids pulling
// pinHash anywhere near a code path that isn't already careful about it).
async function getActorAuditInfo(
  userId: string,
): Promise<{ name: string; facilityName: string | null }> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { name: true, facility: { select: { name: true } } },
  });
  return { name: user.name, facilityName: user.facility?.name ?? null };
}

// REQ-ROLE-003/006 combined: the one place a route asks "can this caller
// read this patient", throwing FORBIDDEN if not, and - only for provider/
// fchv actors, per REQ-ROLE-006's literal wording - writing a throttled
// record_viewed audit row as a side effect of a successful check. Patients
// reading their own record never trigger it (nothing suspicious about that).
export async function assertCanReadPatient(
  actor: AuthenticatedUser,
  patientId: string,
): Promise<void> {
  const allowed = await canReadPatient(actor, patientId);
  if (!allowed) {
    throw new AppError(ErrorCode.FORBIDDEN, 'No access to this patient');
  }
  if (actor.role === Role.provider || actor.role === Role.fchv) {
    const alreadyLogged = await wasRecentlyViewed(actor.id, patientId);
    if (!alreadyLogged) {
      const { name, facilityName } = await getActorAuditInfo(actor.id);
      await logAudit({
        patientId,
        actor: { ...actor, name, facilityName },
        action: AuditAction.record_viewed,
      });
    }
  }
}

export async function assertCanAppendPatient(
  actor: AuthenticatedUser,
  patientId: string,
): Promise<void> {
  const allowed = await canAppendPatient(actor, patientId);
  if (!allowed) {
    throw new AppError(ErrorCode.FORBIDDEN, 'No append access to this patient');
  }
}
