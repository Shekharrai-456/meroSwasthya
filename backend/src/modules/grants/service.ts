import { randomUUID } from 'node:crypto';
import type { Patient } from '../../../generated/prisma/client.js';
import { AuditAction, GrantScope } from '../../../generated/prisma/enums.js';
import { config } from '../../config.js';
import { AppError, ErrorCode } from '../../lib/errors.js';
import { DUMMY_PIN_HASH, verifyPin } from '../../lib/hash.js';
import { prisma } from '../../lib/prisma.js';
import {
  checkFixedWindowLimit,
  checkPinLockout,
  clearPinLockout,
  recordPinFailure,
} from '../../lib/rateLimiter.js';
import {
  type AncContactDto,
  type GrantDto,
  type PatientDto,
  type PregnancyDto,
  toAncContactDto,
  toGrantDto,
  toPatientDto,
} from '../../lib/serializers.js';
import { signGrantToken, verifyGrantToken } from '../../lib/tokens.js';
import { type AuthenticatedUser, getActorAuditInfo } from '../../plugins/auth.js';
import { logAudit } from '../audit/service.js';
import { type PatientSummary, buildPatientSummary } from '../patients/summary.js';
import { type TimelineItemDto, buildPatientTimeline } from '../patients/timeline.js';
import {
  PRINTED_GRANT_TTL_MINUTES,
  type GrantCreateInput,
  type GrantRedeemInput,
} from './schemas.js';

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

  // REQ-GRANT-012: the printed card's scope/ttl are server-forced constants,
  // never read from `input` even though the schema would reject a
  // conflicting client value anyway - defense in depth against a future
  // schema change accidentally loosening that guarantee.
  const ttlMinutes = input.printed
    ? PRINTED_GRANT_TTL_MINUTES
    : (input.ttlMinutes ?? config.GRANT_TTL_MIN_DEFAULT);
  const scope = input.printed ? GrantScope.read : (input.scope as GrantScope);
  const tokenJti = randomUUID();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  const grant = await prisma.accessGrant.create({
    data: {
      patientId: patient.id,
      scope,
      tokenJti,
      expiresAt,
      printed: input.printed,
    },
  });

  const token = await signGrantToken({ gid: tokenJti, pid: patient.id, scope }, ttlMinutes);

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
  summary: PatientSummary;
  timeline: TimelineItemDto[];
  pregnancy: PregnancyDto | null;
  ancContacts: AncContactDto[];
}

// REQ-GRANT-007: "same summary object as GET /patients/:id", latest-50
// timeline, active pregnancy, and all its ANC contacts - reuses
// patients/summary.ts and patients/timeline.ts rather than re-deriving this
// read model a second way (same "one implementation, reused everywhere"
// principle as Sync's dispatcher, docs/PROGRESS.md's Session 12 entry).
// `ancContacts` is all contacts for the *active* pregnancy specifically
// (backend.md §9.2's bundle lists `pregnancy` and `ancContacts` as
// siblings) - empty when there is none.
async function buildRedeemBundle(patient: Patient, grant: GrantDto): Promise<RedeemGrantResult> {
  const summary = await buildPatientSummary(patient);
  const { items: timeline } = await buildPatientTimeline(patient.id, null, 50);
  const ancContacts = summary.activePregnancy
    ? (
        await prisma.ancContact.findMany({
          where: { pregnancyId: summary.activePregnancy.id, deleted: false },
          orderBy: { contactNo: 'asc' },
        })
      ).map(toAncContactDto)
    : [];

  return {
    grant,
    patient: toPatientDto(patient),
    summary,
    timeline,
    pregnancy: summary.activePregnancy,
    ancContacts,
  };
}

// REQ-GRANT-003..007. Returns the full offline bundle a provider app caches
// after scanning a QR code.
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
    // access past the original 24h window). No PIN re-check either - the
    // PIN's job is to gate the *first* redemption; from then on, the
    // redeeming account's own auth (requireAuth + requireRole) is what
    // gates further access, same as an ordinary grant.
    return buildRedeemBundle(patient, toGrantDto(grant));
  }

  // REQ-GRANT-012: the printed card's long token lifetime is offset by
  // requiring the *patient's* PIN (not the redeemer's) on this first real
  // redemption - same defensive pattern as auth/service.ts's loginWithPin
  // (constant-time-ish via DUMMY_PIN_HASH, a lockout keyed by the patient's
  // phone, reusing the same Redis-backed counters PIN login already uses).
  if (grant.printed) {
    if (!input.pin) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'PIN is required to redeem this grant', [
        { field: 'pin', message: 'required' },
      ]);
    }
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: patient.ownerUserId } });
    const lockout = await checkPinLockout(owner.phone);
    if (!lockout.allowed) {
      throw new AppError(
        ErrorCode.RATE_LIMITED,
        `Too many PIN attempts, try again in ${lockout.retryAfterSec}s`,
      );
    }
    const pinMatches = await verifyPin(owner.pinHash ?? DUMMY_PIN_HASH, input.pin);
    if (!owner.pinHash || !pinMatches) {
      await recordPinFailure(owner.phone);
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Invalid PIN');
    }
    await clearPinLockout(owner.phone);
  }

  // AMBIGUITIES A4 resolved: the printed card's own token `exp` (1 year) is
  // just how long the physical card stays scannable - the access window it
  // grants once redeemed is the same +24h as every other grant, not a
  // year of standing access. A long-lived *credential* is not the same
  // thing as long-lived *access*, and only the latter needs bounding here.
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

  return buildRedeemBundle(patient, toGrantDto(updated));
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
