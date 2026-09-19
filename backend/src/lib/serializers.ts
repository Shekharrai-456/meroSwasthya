import type {
  AccessGrant,
  AuditEntry,
  Patient,
  Prisma,
  Visit,
} from '../../generated/prisma/client.js';
import { toDateOnly } from './dates.js';

// The only place a User row becomes API JSON (REQ-API-007, REQ-USER-002).
// Deliberately whitelist-only: this function never spreads the source row, so
// pinHash can never leak into a response body even if a caller passes a row
// with extra fields selected.

export type UserWithFacility = Prisma.UserGetPayload<{ include: { facility: true } }>;

export interface UserDto {
  id: string;
  phone: string;
  role: string;
  name: string;
  facilityId: string | null;
  facilityName: string | null;
  createdAt: string;
}

export function toUserDto(user: UserWithFacility): UserDto {
  return {
    id: user.id,
    phone: user.phone,
    role: user.role,
    name: user.name,
    facilityId: user.facilityId,
    facilityName: user.facility?.name ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

// REQ-PATIENT-011, matching backend.md §8's toPatientDto example exactly.
// Same whitelist-only discipline as toUserDto - never spreads the source row.
export interface PatientDto {
  id: string;
  ownerUserId: string;
  name: string;
  sex: string;
  dob: string;
  bloodGroup: string | null;
  ward: number | null;
  municipality: string | null;
  allergies: string[];
  chronicConditions: string[];
  emergencyContactPhone: string | null;
  version: number;
  updatedAt: string;
  deleted: boolean;
}

export function toPatientDto(patient: Patient): PatientDto {
  return {
    id: patient.id,
    ownerUserId: patient.ownerUserId,
    name: patient.name,
    sex: patient.sex,
    dob: toDateOnly(patient.dob),
    bloodGroup: patient.bloodGroup,
    ward: patient.ward,
    municipality: patient.municipality,
    allergies: patient.allergies as string[],
    chronicConditions: patient.chronicConditions as string[],
    emergencyContactPhone: patient.emergencyContactPhone,
    version: patient.version,
    updatedAt: patient.updatedAt.toISOString(),
    deleted: patient.deleted,
  };
}

// REQ-AUDIT-001/002/003. Never includes a `deleted` field - AuditEntry rows
// have no such column (immutable by design).
export interface AuditDto {
  id: string;
  patientId: string;
  actorUserId: string;
  actorName: string;
  actorFacilityName: string | null;
  action: string;
  grantId: string | null;
  at: string;
}

export function toAuditDto(entry: AuditEntry): AuditDto {
  return {
    id: entry.id,
    patientId: entry.patientId,
    actorUserId: entry.actorUserId,
    actorName: entry.actorName,
    actorFacilityName: entry.actorFacilityName,
    action: entry.action,
    grantId: entry.grantId,
    at: entry.at.toISOString(),
  };
}

// REQ-GRANT-001..009. "never includes token" (backend.md §8) - the raw signed
// JWT is returned separately, only once, on POST /grants's own response
// (`token`/`qrPayload` fields); it is never re-derivable from this DTO.
export interface GrantDto {
  id: string;
  patientId: string;
  scope: string;
  tokenJti: string;
  expiresAt: string;
  redeemedByUserId: string | null;
  redeemedAt: string | null;
  accessUntil: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export function toGrantDto(grant: AccessGrant): GrantDto {
  return {
    id: grant.id,
    patientId: grant.patientId,
    scope: grant.scope,
    tokenJti: grant.tokenJti,
    expiresAt: grant.expiresAt.toISOString(),
    redeemedByUserId: grant.redeemedByUserId,
    redeemedAt: grant.redeemedAt?.toISOString() ?? null,
    accessUntil: grant.accessUntil?.toISOString() ?? null,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    createdAt: grant.createdAt.toISOString(),
  };
}

// REQ-VISIT-009: Prescription is embedded JSON on Visit, never a separate
// table/row - "never sent alone" per backend.md A.2, so it has no id-based
// lookup or its own serializer entry point, only this shape.
export interface PrescriptionDto {
  id: string;
  drugCode: string;
  drugName: string;
  dose: string;
  frequency: string;
  durationDays: number;
  instructionsNp: string | null;
}

// REQ-VISIT-001..009. Same whitelist-only discipline as every other DTO -
// vitals/diagnosisCodes/referral/prescriptions are typed Json columns cast to
// their documented shape, matching backend.md A.2 exactly.
export interface VisitDto {
  id: string;
  patientId: string;
  providerUserId: string;
  providerName: string;
  facilityId: string | null;
  facilityName: string | null;
  visitAt: string;
  chiefComplaintCode: string;
  vitals: Record<string, unknown>;
  diagnosisCodes: string[];
  notes: string | null;
  advice: string | null;
  followUpAt: string | null;
  referral: Record<string, unknown> | null;
  prescriptions: PrescriptionDto[];
  supersedesId: string | null;
  version: number;
  updatedAt: string;
  deleted: boolean;
}

export function toVisitDto(visit: Visit): VisitDto {
  return {
    id: visit.id,
    patientId: visit.patientId,
    providerUserId: visit.providerUserId,
    providerName: visit.providerName,
    facilityId: visit.facilityId,
    facilityName: visit.facilityName,
    visitAt: visit.visitAt.toISOString(),
    chiefComplaintCode: visit.chiefComplaintCode,
    vitals: visit.vitals as Record<string, unknown>,
    diagnosisCodes: visit.diagnosisCodes as string[],
    notes: visit.notes,
    advice: visit.advice,
    followUpAt: visit.followUpAt ? toDateOnly(visit.followUpAt) : null,
    referral: visit.referral as Record<string, unknown> | null,
    prescriptions: visit.prescriptions as unknown as PrescriptionDto[],
    supersedesId: visit.supersedesId,
    version: visit.version,
    updatedAt: visit.updatedAt.toISOString(),
    deleted: visit.deleted,
  };
}
