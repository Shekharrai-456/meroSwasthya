import { randomUUID } from 'node:crypto';
import { AuditAction } from '../../../generated/prisma/enums.js';
import { config } from '../../config.js';
import { AppError, ErrorCode } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { checkFixedWindowLimit } from '../../lib/rateLimiter.js';
import { type GrantDto, type PatientDto, toGrantDto, toPatientDto } from '../../lib/serializers.js';
import { signGrantToken, verifyGrantToken } from '../../lib/tokens.js';
import { type AuthenticatedUser, getActorAuditInfo } from '../../plugins/auth.js';
import { logAudit } from '../audit/service.js';
import type { GrantCreateInput, GrantRedeemInput } from './schemas.js';

// REQ-GRANT-001: 20 per patient per hour, independent of who is creating them
// (always the owner, but keyed on the patient so the limit tracks the shared
// resource being protected).
const GRANT_CREATE_LIMIT = 20;
const GRANT_CREATE_WINDOW_SEC = 3600;

const GRANT_ACCESS_WINDOW_MS = config.GRANT_ACCESS_WINDOW_H * 60 * 60 * 1000;

async function findOwnedPatientOrThrow(actorId: string, patientId: string) {
  const patient = await prisma.patient.findFirst({ where: { id: patientId, deleted: false } });
  if (!patient) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Patient not found');
  }
  if (patient.ownerUserId !== actorId) {
    throw new AppError(ErrorCode.FORBIDDEN, 'Only the owner may do this');
  }
  return patient;
}

export interface CreateGrantResult {
  grant: GrantDto;
  token: string;
  qrPayload: string;
}

// REQ-GRANT-001/002. jti = a fresh uuid, stored as AccessGrant.tokenJti and
// embedded in the signed token as `gid` - the DB row is the source of truth
// (revocable, inspectable), the token is just a bearer credential pointing
// at it.
export async function createGrant(
  actor: AuthenticatedUser,
  input: GrantCreateInput,
): Promise<CreateGrantResult> {
  const patient = await findOwnedPatientOrThrow(actor.id, input.patientId);

  const limit = await checkFixedWindowLimit(
    `grant-create:${patient.id}`,
    GRANT_CREATE_LIMIT,
    GRANT_CREATE_WINDOW_SEC,
  );
  if (!limit.allowed) {
    throw new AppError(
      ErrorCode.RATE_LIMITED,
      `Too many grants created for this patient, try again in ${limit.retryAfterSec}s`,
    );
  }

  const ttlMinutes = input.ttlMinutes ?? config.GRANT_TTL_MIN_DEFAULT;
  const tokenJti = randomUUID();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  const grant = await prisma.accessGrant.create({
    data: {
      patientId: patient.id,
      scope: input.scope,
      tokenJti,
      expiresAt,
    },
  });

  const token = await signGrantToken(
    { gid: tokenJti, pid: patient.id, scope: input.scope },
    ttlMinutes,
  );

  const { name, facilityName } = await getActorAuditInfo(actor.id);
  await logAudit({
    patientId: patient.id,
    actor: { ...actor, name, facilityName },
    action: AuditAction.grant_created,
    grantId: grant.id,
  });

  return { grant: toGrantDto(grant), token, qrPayload: `SWC1:${token}` };
}

export interface RedeemGrantResult {
  grant: GrantDto;
  patient: PatientDto;
}

// REQ-GRANT-003..007. Redeem bundle ships as {grant, patient} only -
// `summary`/`timeline`/`pregnancy`/`ancContacts` all depend on Visit/
// Pregnancy/AncContact tables that don't exist until Phase 5/7, same
// reasoning as GET /patients/:id in Session 4. Not faked here either.
export async function redeemGrant(
  actor: AuthenticatedUser,
  input: GrantRedeemInput,
): Promise<RedeemGrantResult> {
  const token = input.qrPayload.slice('SWC1:'.length);
  const payload = await verifyGrantToken(token); // throws GRANT_EXPIRED on any failure

  const grant = await prisma.accessGrant.findUnique({ where: { tokenJti: payload.gid } });
  if (!grant) {
    throw new AppError(ErrorCode.GRANT_EXPIRED, 'Grant token is invalid or expired');
  }
  if (grant.revokedAt || grant.expiresAt.getTime() < Date.now()) {
    throw new AppError(ErrorCode.GRANT_EXPIRED, 'Grant token is invalid or expired');
  }

  if (grant.redeemedByUserId && grant.redeemedByUserId !== actor.id) {
    throw new AppError(
      ErrorCode.ALREADY_REDEEMED,
      'This grant was already redeemed by someone else',
    );
  }

  const patient = await prisma.patient.findFirst({
    where: { id: grant.patientId, deleted: false },
  });
  if (!patient) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Patient not found');
  }

  if (grant.redeemedByUserId === actor.id) {
    // Idempotent re-redeem: return the bundle again, no new audit row, no
    // accessUntil extension (a repeated scan shouldn't silently prolong
    // access past the original 24h window).
    return { grant: toGrantDto(grant), patient: toPatientDto(patient) };
  }

  const accessUntil = new Date(Date.now() + GRANT_ACCESS_WINDOW_MS);
  const updated = await prisma.accessGrant.update({
    where: { id: grant.id },
    data: { redeemedByUserId: actor.id, redeemedAt: new Date(), accessUntil },
  });

  const { name, facilityName } = await getActorAuditInfo(actor.id);
  await logAudit({
    patientId: patient.id,
    actor: { ...actor, name, facilityName },
    action: AuditAction.grant_redeemed,
    grantId: grant.id,
  });

  return { grant: toGrantDto(updated), patient: toPatientDto(patient) };
}

// REQ-GRANT-008: owner-only, ends access immediately (canReadPatient/
// canAppendPatient already check revokedAt IS NULL on every call - built in
// Session 4 - so this has no separate "propagate revocation" step to write).
export async function revokeGrant(actor: AuthenticatedUser, grantId: string): Promise<GrantDto> {
  const grant = await prisma.accessGrant.findUnique({ where: { id: grantId } });
  if (!grant) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Grant not found');
  }
  await findOwnedPatientOrThrow(actor.id, grant.patientId);

  const updated = grant.revokedAt
    ? grant
    : await prisma.accessGrant.update({ where: { id: grantId }, data: { revokedAt: new Date() } });

  if (!grant.revokedAt) {
    const { name, facilityName } = await getActorAuditInfo(actor.id);
    await logAudit({
      patientId: grant.patientId,
      actor: { ...actor, name, facilityName },
      action: AuditAction.grant_revoked,
      grantId: grant.id,
    });
  }

  return toGrantDto(updated);
}
