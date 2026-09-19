import type {
  AccessGrant,
  AncContact,
  AuditEntry,
  CodeListItem,
  Delivery,
  Document,
  Facility,
  Patient,
  Pregnancy,
  Prisma,
  Reminder,
  Visit,
} from '../../generated/prisma/client.js';
import { toDateOnly } from './dates.js';
import { gestationalAgeDays } from '../modules/maternal/rules/edd.js';

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

// REQ-CODELIST-002.
export interface CodeListItemDto {
  kind: string;
  code: string;
  labelEn: string;
  labelNp: string;
  meta: Record<string, unknown> | null;
}

export function toCodeListItemDto(item: CodeListItem): CodeListItemDto {
  return {
    kind: item.kind,
    code: item.code,
    labelEn: item.labelEn,
    labelNp: item.labelNp,
    meta: item.meta as Record<string, unknown> | null,
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

// REQ-FACILITY-002. `distanceKm` is "only in /facilities/nearby responses"
// per backend.md A.2 - every other caller (e.g. REQ-PREG-013's
// nearestReferral) passes null, matching the "nullable field always
// present as null" API convention rather than omitting the key.
export interface FacilityDto {
  id: string;
  name: string;
  type: string;
  hasBirthingCentre: boolean;
  phone: string | null;
  lat: number;
  lng: number;
  municipality: string;
  distanceKm: number | null;
}

export function toFacilityDto(facility: Facility, distanceKm: number | null = null): FacilityDto {
  return {
    id: facility.id,
    name: facility.name,
    type: facility.type,
    hasBirthingCentre: facility.hasBirthingCentre,
    phone: facility.phone,
    lat: facility.lat,
    lng: facility.lng,
    municipality: facility.municipality,
    distanceKm,
  };
}

// REQ-PREG-*. Same whitelist-only discipline as every other DTO.
export interface AncContactDto {
  id: string;
  pregnancyId: string;
  contactNo: number;
  weekTarget: number;
  dueAt: string;
  doneAt: string | null;
  providerUserId: string | null;
  findings: Record<string, unknown> | null;
  dangerSigns: string[];
  triageLevel: string | null;
  triageReasons: string[];
  referral: Record<string, unknown> | null;
  version: number;
  updatedAt: string;
  deleted: boolean;
}

export function toAncContactDto(contact: AncContact): AncContactDto {
  return {
    id: contact.id,
    pregnancyId: contact.pregnancyId,
    contactNo: contact.contactNo,
    weekTarget: contact.weekTarget,
    dueAt: toDateOnly(contact.dueAt),
    doneAt: contact.doneAt?.toISOString() ?? null,
    providerUserId: contact.providerUserId,
    findings: contact.findings as Record<string, unknown> | null,
    dangerSigns: contact.dangerSigns as string[],
    triageLevel: contact.triageLevel,
    triageReasons: contact.triageReasons as string[],
    referral: contact.referral as Record<string, unknown> | null,
    version: contact.version,
    updatedAt: contact.updatedAt.toISOString(),
    deleted: contact.deleted,
  };
}

export interface DeliveryDto {
  id: string;
  pregnancyId: string;
  deliveredAt: string;
  place: string;
  mode: string;
  outcome: string;
  babyWeightKg: number | null;
  babySex: string | null;
  complications: string[];
  version: number;
  updatedAt: string;
  deleted: boolean;
}

export function toDeliveryDto(delivery: Delivery): DeliveryDto {
  return {
    id: delivery.id,
    pregnancyId: delivery.pregnancyId,
    deliveredAt: delivery.deliveredAt.toISOString(),
    place: delivery.place,
    mode: delivery.mode,
    outcome: delivery.outcome,
    babyWeightKg: delivery.babyWeightKg,
    babySex: delivery.babySex,
    complications: delivery.complications as string[],
    version: delivery.version,
    updatedAt: delivery.updatedAt.toISOString(),
    deleted: delivery.deleted,
  };
}

// REQ-PREG-*. `gestationalAgeDays`/`nextContact` are computed on read, never
// stored (backend.md A.2) - `contacts` is optional so callers that only have
// the pregnancy row on hand (e.g. a PATCH response) can still serialize it,
// at the cost of `nextContact` being null rather than computed.
export interface PregnancyDto {
  id: string;
  patientId: string;
  lmp: string | null;
  edd: string;
  gravida: number;
  para: number;
  riskFactors: string[];
  riskLevel: string;
  status: string;
  birthPlan: Record<string, unknown> | null;
  registeredByUserId: string;
  gestationalAgeDays: number;
  nextContact: AncContactDto | null;
  version: number;
  updatedAt: string;
  deleted: boolean;
}

// REQ-PREG-008. Server-owned, not syncable (REQ-REMIND-009) - the client
// only ever reads these.
export interface ReminderDto {
  id: string;
  patientId: string;
  pregnancyId: string | null;
  kind: string;
  dueAt: string;
  channel: string;
  recipientPhone: string;
  recipientRole: string;
  messageNp: string;
  messageEn: string;
  status: string;
  sentAt: string | null;
}

export function toReminderDto(reminder: Reminder): ReminderDto {
  return {
    id: reminder.id,
    patientId: reminder.patientId,
    pregnancyId: reminder.pregnancyId,
    kind: reminder.kind,
    dueAt: reminder.dueAt.toISOString(),
    channel: reminder.channel,
    recipientPhone: reminder.recipientPhone,
    recipientRole: reminder.recipientRole,
    messageNp: reminder.messageNp,
    messageEn: reminder.messageEn,
    status: reminder.status,
    sentAt: reminder.sentAt?.toISOString() ?? null,
  };
}

export function toPregnancyDto(pregnancy: Pregnancy, contacts: AncContact[] = []): PregnancyDto {
  const nextContact = contacts
    .filter((c) => c.doneAt === null && !c.deleted)
    .sort((a, b) => a.contactNo - b.contactNo)[0];

  return {
    id: pregnancy.id,
    patientId: pregnancy.patientId,
    lmp: pregnancy.lmp ? toDateOnly(pregnancy.lmp) : null,
    edd: toDateOnly(pregnancy.edd),
    gravida: pregnancy.gravida,
    para: pregnancy.para,
    riskFactors: pregnancy.riskFactors as string[],
    riskLevel: pregnancy.riskLevel,
    status: pregnancy.status,
    birthPlan: pregnancy.birthPlan as Record<string, unknown> | null,
    registeredByUserId: pregnancy.registeredByUserId,
    gestationalAgeDays: gestationalAgeDays(toDateOnly(pregnancy.edd), new Date()),
    nextContact: nextContact ? toAncContactDto(nextContact) : null,
    version: pregnancy.version,
    updatedAt: pregnancy.updatedAt.toISOString(),
    deleted: pregnancy.deleted,
  };
}

// REQ-DOC-001..008. `downloadUrl` is computed on read (a fresh presigned
// URL each time, per REQ-DOC-005), never stored - passed in by the caller
// since generating it needs the storage adapter, which this file has no
// business depending on.
export interface DocumentDto {
  id: string;
  patientId: string;
  uploadedByUserId: string;
  type: string;
  title: string;
  takenAt: string;
  status: string;
  downloadUrl: string | null;
  aiSummary: string | null;
  aiSummaryStatus: string;
  version: number;
  updatedAt: string;
  deleted: boolean;
}

export function toDocumentDto(document: Document, downloadUrl: string | null = null): DocumentDto {
  return {
    id: document.id,
    patientId: document.patientId,
    uploadedByUserId: document.uploadedByUserId,
    type: document.type,
    title: document.title,
    takenAt: toDateOnly(document.takenAt),
    status: document.status,
    downloadUrl,
    aiSummary: document.aiSummary,
    aiSummaryStatus: document.aiSummaryStatus,
    version: document.version,
    updatedAt: document.updatedAt.toISOString(),
    deleted: document.deleted,
  };
}
