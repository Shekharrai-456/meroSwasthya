import { ReminderKind, Role } from '../../../generated/prisma/enums.js';
import { Prisma, type Patient } from '../../../generated/prisma/client.js';
import { AuditAction } from '../../../generated/prisma/enums.js';
import { kathmanduNineAm } from '../../lib/dates.js';
import { AppError, ErrorCode, type ValidationDetail } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { type VisitDto, toVisitDto } from '../../lib/serializers.js';
import {
  type AuthenticatedUser,
  assertCanAppendPatient,
  getActorAuditInfo,
} from '../../plugins/auth.js';
import { logAudit } from '../audit/service.js';
import { buildFollowUpMessages } from '../reminders/templates.js';
import type { VisitCreateInput } from './schemas.js';

export async function findPatientOrThrow(patientId: string): Promise<Patient> {
  const patient = await prisma.patient.findFirst({ where: { id: patientId, deleted: false } });
  if (!patient) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Patient not found');
  }
  return patient;
}

// REQ-VISIT-004: complaint/diagnosis/drug codes must exist in the codelist,
// else 400 VALIDATION_ERROR with field-level details - checked in one query
// regardless of how many codes are on the visit (no N+1, CLAUDE.md §7).
async function assertCodesExist(
  entries: { kind: string; code: string; field: string }[],
): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  const rows = await prisma.codeListItem.findMany({
    where: { OR: entries.map((entry) => ({ kind: entry.kind, code: entry.code })) },
    select: { kind: true, code: true },
  });
  const found = new Set(rows.map((row) => `${row.kind}:${row.code}`));
  const details: ValidationDetail[] = entries
    .filter((entry) => !found.has(`${entry.kind}:${entry.code}`))
    .map((entry) => ({
      field: entry.field,
      message: `Unknown ${entry.kind} code "${entry.code}"`,
    }));
  if (details.length > 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'One or more codes are not recognised', details);
  }
}

function codeCheckEntries(
  input: VisitCreateInput,
): { kind: string; code: string; field: string }[] {
  const entries = [
    { kind: 'complaint', code: input.chiefComplaintCode, field: 'chiefComplaintCode' },
    ...input.diagnosisCodes.map((code, i) => ({
      kind: 'diagnosis',
      code,
      field: `diagnosisCodes[${i}]`,
    })),
    ...input.prescriptions.map((rx, i) => ({
      kind: 'drug',
      code: rx.drugCode,
      field: `prescriptions[${i}].drugCode`,
    })),
  ];
  return entries;
}

// REQ-VISIT-003: providerUserId/providerName/facility on the Visit itself are
// server-filled from the authenticated actor, never the request body.
// "Self-reported" applies exactly when the patient owner is the one
// recording the visit - true regardless of the owner's role, since a
// patient-role actor can never hold an append grant on someone else's
// record (grants can only be redeemed by provider/fchv, REQ-GRANT-003), so
// this is the only way a non-owner-role actor could reach this branch, and
// the wording keys on ownership, not role.
//
// Takes the actor's real name/facility as an argument rather than looking it
// up itself: `getActorAuditInfo` is also always needed for REQ-VISIT-006's
// audit entry (the audit trail records the real actor, never "Self-reported"),
// so the caller fetches it once and both this function and the audit write
// reuse it - avoiding two identical queries in one request (Session 8
// performance pass finding).
function resolveVisitProviderInfo(
  actor: AuthenticatedUser,
  patient: Patient,
  actorInfo: { name: string; facilityName: string | null },
): { providerName: string; facilityId: string | null; facilityName: string | null } {
  if (actor.id === patient.ownerUserId) {
    return { providerName: 'Self-reported', facilityId: null, facilityName: null };
  }
  return {
    providerName: actorInfo.name,
    facilityId: actor.facilityId,
    facilityName: actorInfo.facilityName,
  };
}

// REQ-VISIT-001..006/009. Order: patient must exist (404) -> role gate (403,
// REQ-ROLE-005) -> object-level append access (403, REQ-ROLE-004) ->
// idempotency (REQ-VISIT-002) -> code validation (REQ-VISIT-004) -> write.
export async function createVisit(
  actor: AuthenticatedUser,
  patientId: string,
  input: VisitCreateInput,
): Promise<VisitDto> {
  const patient = await findPatientOrThrow(patientId);

  if (actor.role === Role.fchv) {
    throw new AppError(ErrorCode.FORBIDDEN, 'fchv may not record visits');
  }
  await assertCanAppendPatient(actor, patientId);

  const existing = await prisma.visit.findUnique({ where: { id: input.id } });
  if (existing) {
    if (existing.patientId !== patientId) {
      throw new AppError(ErrorCode.FORBIDDEN, 'This visit id belongs to a different patient');
    }
    return toVisitDto(existing);
  }

  await assertCodesExist(codeCheckEntries(input));

  const actorInfo = await getActorAuditInfo(actor.id);
  const { providerName, facilityId, facilityName } = resolveVisitProviderInfo(
    actor,
    patient,
    actorInfo,
  );

  const { visit } = await prisma.$transaction(async (tx) => {
    const createdVisit = await tx.visit.create({
      data: {
        id: input.id,
        patientId,
        providerUserId: actor.id,
        providerName,
        facilityId,
        facilityName,
        visitAt: new Date(input.visitAt),
        chiefComplaintCode: input.chiefComplaintCode,
        vitals: input.vitals,
        diagnosisCodes: input.diagnosisCodes,
        notes: input.notes ?? null,
        advice: input.advice ?? null,
        followUpAt: input.followUpAt ? new Date(input.followUpAt) : null,
        referral: input.referral ?? Prisma.JsonNull,
        prescriptions: input.prescriptions,
        supersedesId: input.supersedesId ?? null,
      },
    });

    // REQ-VISIT-005: follow-up reminder, recipient = patient owner's phone.
    if (input.followUpAt) {
      const owner = await tx.user.findUniqueOrThrow({
        where: { id: patient.ownerUserId },
        select: { phone: true },
      });
      const messages = buildFollowUpMessages(patient.name, input.followUpAt);
      await tx.reminder.create({
        data: {
          patientId,
          refId: createdVisit.id,
          kind: ReminderKind.follow_up,
          dueAt: kathmanduNineAm(input.followUpAt, -1),
          recipientPhone: owner.phone,
          recipientRole: 'patient',
          messageNp: messages.np,
          messageEn: messages.en,
        },
      });
    }

    return { visit: createdVisit };
  });

  // REQ-VISIT-006. Not inside the transaction above, same convention as
  // every other module's audit write (grants/service.ts, plugins/auth.ts) -
  // audit is a best-effort side effect of a successfully committed write,
  // not part of its atomic unit. Reuses `actorInfo` fetched above.
  await logAudit({
    patientId,
    actor: { ...actor, name: actorInfo.name, facilityName: actorInfo.facilityName },
    action: AuditAction.visit_added,
  });

  return toVisitDto(visit);
}

// REQ-VISIT-007: canRead-gated (checked by the caller, modules/visits/routes.ts,
// same existence-then-access pattern as modules/patients/routes.ts), newest
// first.
export async function listVisits(patientId: string, limit: number): Promise<VisitDto[]> {
  const visits = await prisma.visit.findMany({
    where: { patientId, deleted: false },
    orderBy: { visitAt: 'desc' },
    take: limit,
  });
  return visits.map(toVisitDto);
}
