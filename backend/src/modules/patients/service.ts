import { Role } from '../../../generated/prisma/enums.js';
import { AppError, ErrorCode } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { type AuditDto, type PatientDto, toPatientDto } from '../../lib/serializers.js';
import type { AuthenticatedUser } from '../../plugins/auth.js';
import { getAuditForPatient } from '../audit/service.js';
import type { PatientCreateInput, PatientUpdateInput } from './schemas.js';

// REQ-PATIENT-001/002: client-generated id makes create naturally idempotent.
// Same id + same owner -> return the existing row (no-op retry). Same id +
// different owner -> FORBIDDEN, not a generic conflict - this is "that id
// isn't yours", not "that id is taken".
export async function createPatient(
  actor: AuthenticatedUser,
  input: PatientCreateInput,
): Promise<PatientDto> {
  const existing = await prisma.patient.findUnique({ where: { id: input.id } });
  if (existing) {
    if (existing.ownerUserId !== actor.id) {
      throw new AppError(ErrorCode.FORBIDDEN, 'This patient id belongs to a different owner');
    }
    return toPatientDto(existing);
  }

  const created = await prisma.patient.create({
    data: {
      id: input.id,
      ownerUserId: actor.id,
      name: input.name,
      sex: input.sex,
      dob: new Date(input.dob),
      bloodGroup: input.bloodGroup ?? null,
      ward: input.ward ?? null,
      municipality: input.municipality ?? null,
      allergies: input.allergies,
      chronicConditions: input.chronicConditions,
      emergencyContactPhone: input.emergencyContactPhone ?? null,
    },
  });
  return toPatientDto(created);
}

// REQ-PATIENT-003: owner-only (a stricter, simpler check than
// canAppendPatient's grant-inclusive definition - PATCH edits the patient's
// own demographic record, which no grant scope covers, only ownership does)
// and optimistic-concurrency controlled. A stale `version` never silently
// overwrites - it comes back as the current server row so the client can
// reconcile.
export async function updatePatient(
  actor: AuthenticatedUser,
  patientId: string,
  input: PatientUpdateInput,
): Promise<PatientDto> {
  const patient = await prisma.patient.findFirst({ where: { id: patientId, deleted: false } });
  if (!patient) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Patient not found');
  }
  if (patient.ownerUserId !== actor.id) {
    throw new AppError(ErrorCode.FORBIDDEN, 'Only the owner may update this patient');
  }
  if (patient.version !== input.version) {
    throw new AppError(ErrorCode.VERSION_CONFLICT, 'Patient was updated by someone else', {
      current: toPatientDto(patient),
    });
  }

  const updated = await prisma.patient.update({
    where: { id: patientId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.sex !== undefined && { sex: input.sex }),
      ...(input.dob !== undefined && { dob: new Date(input.dob) }),
      ...(input.bloodGroup !== undefined && { bloodGroup: input.bloodGroup }),
      ...(input.ward !== undefined && { ward: input.ward }),
      ...(input.municipality !== undefined && { municipality: input.municipality }),
      ...(input.allergies !== undefined && { allergies: input.allergies }),
      ...(input.chronicConditions !== undefined && { chronicConditions: input.chronicConditions }),
      ...(input.emergencyContactPhone !== undefined && {
        emergencyContactPhone: input.emergencyContactPhone,
      }),
      version: { increment: 1 },
    },
  });
  return toPatientDto(updated);
}

// REQ-ROLE-007: role patient -> owned only; every other role -> owned union
// active-redeemed-grant patients. Two queries total regardless of result
// size (grant lookup, then patient lookup) - no N+1.
export async function listPatients(actor: AuthenticatedUser): Promise<PatientDto[]> {
  if (actor.role === Role.patient) {
    const owned = await prisma.patient.findMany({
      where: { ownerUserId: actor.id, deleted: false },
      orderBy: { updatedAt: 'desc' },
    });
    return owned.map(toPatientDto);
  }

  const grants = await prisma.accessGrant.findMany({
    where: { redeemedByUserId: actor.id, revokedAt: null, accessUntil: { gt: new Date() } },
    select: { patientId: true },
    distinct: ['patientId'],
  });
  const grantedIds = grants.map((g) => g.patientId);

  const patients = await prisma.patient.findMany({
    where: {
      deleted: false,
      OR: [{ ownerUserId: actor.id }, { id: { in: grantedIds } }],
    },
    orderBy: { updatedAt: 'desc' },
  });
  return patients.map(toPatientDto);
}

// REQ-PATIENT-004: patient entity only, no `summary` block. REQ-PATIENT-005/
// 006/007 (activeProblems/currentMedicines/lastVitals/activePregnancy/
// lastVisitAt/visitCount) are all derived from Visit/Pregnancy records,
// neither of which exists until Phase 5/7 - see docs/PROGRESS.md's Session 4
// entry for why those REQ rows stay NOT_STARTED rather than being faked here.
export async function getPatient(patientId: string): Promise<PatientDto> {
  const patient = await prisma.patient.findFirst({ where: { id: patientId, deleted: false } });
  if (!patient) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Patient not found');
  }
  return toPatientDto(patient);
}

// REQ-PATIENT-010: owner-only, enforced here rather than canReadPatient
// (stricter - API_CONTRACT.md's endpoint table lists this row's role as
// "owner", not "canRead").
export async function getPatientAudit(
  actor: AuthenticatedUser,
  patientId: string,
): Promise<AuditDto[]> {
  const patient = await prisma.patient.findFirst({ where: { id: patientId, deleted: false } });
  if (!patient) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Patient not found');
  }
  if (patient.ownerUserId !== actor.id) {
    throw new AppError(ErrorCode.FORBIDDEN, 'Only the owner may view this audit trail');
  }
  return getAuditForPatient(patientId);
}
