import type { AuditEntry, Patient, Prisma } from '../../generated/prisma/client.js';
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
