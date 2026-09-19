import { Prisma, type AncContact, type Pregnancy } from '../../../generated/prisma/client.js';
import { AuditAction, PregStatus, ReminderKind, Sex } from '../../../generated/prisma/enums.js';
import { kathmanduNineAm, toDateOnly } from '../../lib/dates.js';
import { AppError, ErrorCode } from '../../lib/errors.js';
import { haversineKm } from '../../lib/geo.js';
import { prisma } from '../../lib/prisma.js';
import {
  type AncContactDto,
  type DeliveryDto,
  type FacilityDto,
  type PregnancyDto,
  type ReminderDto,
  toAncContactDto,
  toDeliveryDto,
  toFacilityDto,
  toPregnancyDto,
  toReminderDto,
} from '../../lib/serializers.js';
import {
  type AuthenticatedUser,
  assertCanAppendPatient,
  getActorAuditInfo,
} from '../../plugins/auth.js';
import { logAudit } from '../audit/service.js';
import { eddFromLmp, gestationalAgeDays } from './rules/edd.js';
import { generateContactSchedule } from './rules/schedule.js';
import { triage } from './rules/triage.js';
import type {
  ContactRecordInput,
  DeliveryCreateInput,
  PregnancyCreateInput,
  PregnancyUpdateInput,
} from './schemas.js';

async function findPatientOrThrow(patientId: string) {
  const patient = await prisma.patient.findFirst({ where: { id: patientId, deleted: false } });
  if (!patient) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Patient not found');
  }
  return patient;
}

export async function findPregnancyOrThrow(pregnancyId: string): Promise<Pregnancy> {
  const pregnancy = await prisma.pregnancy.findFirst({
    where: { id: pregnancyId, deleted: false },
  });
  if (!pregnancy) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Pregnancy not found');
  }
  return pregnancy;
}

// Minimal, real bilingual reminder text - same "not the full Phase 8
// templates.ts" reasoning as Visits' follow_up reminder (see
// visits/service.ts). Dates stay AD.
function buildAncDueMessages(
  patientName: string,
  contactNo: number,
  weekTarget: number,
  dueAt: string,
): { np: string; en: string } {
  return {
    np: `${patientName} को गर्भ जाँच ${contactNo} (हप्ता ${weekTarget}) मिति ${dueAt} मा तोकिएको छ। कृपया नजिकको स्वास्थ्य संस्थामा जानुहोस्।`,
    en: `${patientName}'s ANC contact ${contactNo} (week ${weekTarget}) is due on ${dueAt}. Please visit your health facility.`,
  };
}

function buildAncMissedMessages(
  patientName: string,
  contactNo: number,
  dueAt: string,
): { np: string; en: string } {
  return {
    np: `${patientName} को गर्भ जाँच ${contactNo} मिति ${dueAt} मा हुनुपर्थ्यो तर अझै भएको छैन। कृपया चाँडै स्वास्थ्य संस्थामा सम्पर्क गर्नुहोस्।`,
    en: `${patientName}'s ANC contact ${contactNo} was due on ${dueAt} and hasn't been completed yet. Please visit as soon as possible.`,
  };
}

// REQ-PREG-001..007: sex must be female, no second active pregnancy, edd/
// riskLevel computed, transactional creation of the pregnancy + 8 AncContacts
// (deterministic ids) + anc_due/anc_missed reminders.
export async function createPregnancy(
  actor: AuthenticatedUser,
  patientId: string,
  input: PregnancyCreateInput,
): Promise<{ pregnancy: PregnancyDto; ancContacts: AncContactDto[] }> {
  const patient = await findPatientOrThrow(patientId);
  await assertCanAppendPatient(actor, patientId);

  if (patient.sex !== Sex.female) {
    throw new AppError(
      ErrorCode.RULE_VIOLATION,
      'Pregnancy can only be registered for a female patient',
    );
  }

  const existingActive = await prisma.pregnancy.findFirst({
    where: { patientId, status: PregStatus.active, deleted: false },
  });
  if (existingActive) {
    throw new AppError(ErrorCode.RULE_VIOLATION, 'This patient already has an active pregnancy');
  }

  const edd = input.edd ?? eddFromLmp(input.lmp as string);
  const riskLevel = input.riskFactors.length > 0 ? 'high' : 'normal';
  const schedule = generateContactSchedule(input.id, edd);
  const todayDateOnly = toDateOnly(new Date());

  const owner = await prisma.user.findUniqueOrThrow({
    where: { id: patient.ownerUserId },
    select: { phone: true },
  });

  const { pregnancy, contacts } = await prisma.$transaction(async (tx) => {
    const createdPregnancy = await tx.pregnancy.create({
      data: {
        id: input.id,
        patientId,
        lmp: input.lmp ? new Date(input.lmp) : null,
        edd: new Date(edd),
        gravida: input.gravida,
        para: input.para,
        riskFactors: input.riskFactors,
        riskLevel,
        registeredByUserId: actor.id,
        birthPlan: input.birthPlan ?? Prisma.JsonNull,
      },
    });

    const createdContacts: AncContact[] = [];
    for (const entry of schedule) {
      const contact = await tx.ancContact.create({
        data: {
          id: entry.id,
          pregnancyId: createdPregnancy.id,
          contactNo: entry.contactNo,
          weekTarget: entry.weekTarget,
          dueAt: new Date(entry.dueAt),
        },
      });
      createdContacts.push(contact);
    }

    // REQ-PREG-006/007: anc_due only for contacts still in the future, sent
    // to the patient owner's phone AND emergencyContactPhone (if set) as two
    // separate reminder rows; anc_missed for every contact regardless of
    // due date (backend.md §9.5's literal wording - "for each contact", not
    // conditioned on being future).
    for (const contact of createdContacts) {
      const dueAtStr = toDateOnly(contact.dueAt);
      if (dueAtStr > todayDateOnly) {
        const dueMessages = buildAncDueMessages(
          patient.name,
          contact.contactNo,
          contact.weekTarget,
          dueAtStr,
        );
        const dueAtInstant = kathmanduNineAm(dueAtStr, -1);
        await tx.reminder.create({
          data: {
            patientId,
            pregnancyId: createdPregnancy.id,
            refId: contact.id,
            kind: ReminderKind.anc_due,
            dueAt: dueAtInstant,
            recipientPhone: owner.phone,
            recipientRole: 'patient',
            messageNp: dueMessages.np,
            messageEn: dueMessages.en,
          },
        });
        if (patient.emergencyContactPhone) {
          await tx.reminder.create({
            data: {
              patientId,
              pregnancyId: createdPregnancy.id,
              refId: contact.id,
              kind: ReminderKind.anc_due,
              dueAt: dueAtInstant,
              recipientPhone: patient.emergencyContactPhone,
              recipientRole: 'family',
              messageNp: dueMessages.np,
              messageEn: dueMessages.en,
            },
          });
        }
      }
      const missedMessages = buildAncMissedMessages(patient.name, contact.contactNo, dueAtStr);
      await tx.reminder.create({
        data: {
          patientId,
          pregnancyId: createdPregnancy.id,
          refId: contact.id,
          kind: ReminderKind.anc_missed,
          dueAt: kathmanduNineAm(dueAtStr, 3),
          recipientPhone: owner.phone,
          recipientRole: 'patient',
          messageNp: missedMessages.np,
          messageEn: missedMessages.en,
        },
      });
    }

    return { pregnancy: createdPregnancy, contacts: createdContacts };
  });

  return {
    pregnancy: toPregnancyDto(pregnancy, contacts),
    ancContacts: contacts.map(toAncContactDto),
  };
}

// REQ-PREG-008: canRead-gated (checked by the caller, routes.ts), returns
// the pregnancy with all 8 contacts, delivery (if any), and reminders.
export async function getPregnancyBundle(pregnancyId: string): Promise<{
  pregnancy: PregnancyDto;
  ancContacts: AncContactDto[];
  delivery: DeliveryDto | null;
  reminders: ReminderDto[];
}> {
  const pregnancy = await findPregnancyOrThrow(pregnancyId);
  const [contacts, delivery, reminders] = await Promise.all([
    prisma.ancContact.findMany({
      where: { pregnancyId, deleted: false },
      orderBy: { contactNo: 'asc' },
    }),
    prisma.delivery.findFirst({ where: { pregnancyId, deleted: false } }),
    prisma.reminder.findMany({ where: { pregnancyId }, orderBy: { dueAt: 'asc' } }),
  ]);

  return {
    pregnancy: toPregnancyDto(pregnancy, contacts),
    ancContacts: contacts.map(toAncContactDto),
    delivery: delivery ? toDeliveryDto(delivery) : null,
    reminders: reminders.map(toReminderDto),
  };
}

// REQ-PREG-009: version-checked; birthPlan/riskFactors (recomputing
// riskLevel)/status=ended. Cancelling pending reminders on status=ended is
// a deliberate addition beyond backend.md's literal text (which only
// specifies cancelling reminders on delivery) - an "ended" pregnancy (e.g.
// miscarriage/loss) with no further ANC contacts happening shouldn't keep
// sending "your checkup is due" reminders to a grieving family. See
// docs/PROGRESS.md's Session 9 entry.
export async function updatePregnancy(
  actor: AuthenticatedUser,
  pregnancyId: string,
  input: PregnancyUpdateInput,
): Promise<PregnancyDto> {
  const pregnancy = await findPregnancyOrThrow(pregnancyId);
  await assertCanAppendPatient(actor, pregnancy.patientId);

  if (pregnancy.version !== input.version) {
    throw new AppError(ErrorCode.VERSION_CONFLICT, 'Pregnancy was updated by someone else', {
      current: toPregnancyDto(pregnancy),
    });
  }

  const riskLevel =
    input.riskFactors !== undefined
      ? input.riskFactors.length > 0
        ? 'high'
        : 'normal'
      : undefined;

  const { updated, contacts } = await prisma.$transaction(async (tx) => {
    const updatedPregnancy = await tx.pregnancy.update({
      where: { id: pregnancyId },
      data: {
        ...(input.birthPlan !== undefined && {
          birthPlan: input.birthPlan ?? Prisma.JsonNull,
        }),
        ...(input.riskFactors !== undefined && { riskFactors: input.riskFactors, riskLevel }),
        ...(input.status === 'ended' && { status: PregStatus.ended }),
        version: { increment: 1 },
      },
    });
    if (input.status === 'ended') {
      await tx.reminder.updateMany({
        where: { pregnancyId, status: 'pending' },
        data: { status: 'cancelled' },
      });
    }
    const updatedContacts = await tx.ancContact.findMany({
      where: { pregnancyId, deleted: false },
      orderBy: { contactNo: 'asc' },
    });
    return { updated: updatedPregnancy, contacts: updatedContacts };
  });

  return toPregnancyDto(updated, contacts);
}

// REQ-PREG-013: nearest facility with a birthing centre to the acting
// provider's own facility. Null if the actor has no facility (e.g. a
// patient-role owner recording their own contact) or no birthing facility
// exists yet (no seed data - REQ-SEED-001, not started).
async function findNearestBirthingFacility(
  actorFacilityId: string | null,
): Promise<FacilityDto | null> {
  if (!actorFacilityId) {
    return null;
  }
  const actorFacility = await prisma.facility.findUnique({ where: { id: actorFacilityId } });
  if (!actorFacility) {
    return null;
  }
  const candidates = await prisma.facility.findMany({ where: { hasBirthingCentre: true } });
  if (candidates.length === 0) {
    return null;
  }
  let best = candidates[0];
  let bestKm = haversineKm(actorFacility, candidates[0] as (typeof candidates)[number]);
  for (const candidate of candidates.slice(1)) {
    const km = haversineKm(actorFacility, candidate);
    if (km < bestKm) {
      best = candidate;
      bestKm = km;
    }
  }
  return toFacilityDto(best as (typeof candidates)[number], bestKm);
}

// REQ-PREG-010..014: contactNo 1..8, contact must exist (all 8 are created
// with the pregnancy). gaDays and triage are computed server-side and win
// over whatever the client computed locally (REQ-RULES-004).
export async function recordContact(
  actor: AuthenticatedUser,
  pregnancyId: string,
  contactNo: number,
  input: ContactRecordInput,
): Promise<{ ancContact: AncContactDto; nearestReferral: FacilityDto | null }> {
  const pregnancy = await findPregnancyOrThrow(pregnancyId);
  await assertCanAppendPatient(actor, pregnancy.patientId);

  const contact = await prisma.ancContact.findFirst({
    where: { pregnancyId, contactNo, deleted: false },
  });
  if (!contact) {
    throw new AppError(ErrorCode.NOT_FOUND, 'ANC contact not found');
  }

  const doneAt = new Date(input.doneAt);
  const gaDays = gestationalAgeDays(toDateOnly(pregnancy.edd), doneAt);
  const result = triage({
    findings: input.findings ?? null,
    dangerSigns: input.dangerSigns,
    riskLevel: pregnancy.riskLevel,
    gaDays,
  });

  const { updated } = await prisma.$transaction(async (tx) => {
    const updatedContact = await tx.ancContact.update({
      where: { id: contact.id },
      data: {
        doneAt,
        providerUserId: actor.id,
        findings: input.findings ?? Prisma.JsonNull,
        dangerSigns: input.dangerSigns,
        triageLevel: result.level,
        triageReasons: result.reasons,
        referral: input.referral ?? Prisma.JsonNull,
        version: { increment: 1 },
      },
    });
    // REQ-PREG-012: cancel any pending anc_missed reminder for this contact.
    await tx.reminder.updateMany({
      where: { refId: contact.id, kind: ReminderKind.anc_missed, status: 'pending' },
      data: { status: 'cancelled' },
    });
    return { updated: updatedContact };
  });

  const nearestReferral = await findNearestBirthingFacility(actor.facilityId);

  const { name, facilityName } = await getActorAuditInfo(actor.id);
  await logAudit({
    patientId: pregnancy.patientId,
    actor: { ...actor, name, facilityName },
    action: AuditAction.contact_recorded,
  });

  return { ancContact: toAncContactDto(updated), nearestReferral };
}

// REQ-PREG-015: pregnancy must be active; idempotent on the client-generated
// delivery id (same convention as Visits/Patients); cancels all pending
// reminders for the pregnancy once delivered.
export async function recordDelivery(
  actor: AuthenticatedUser,
  pregnancyId: string,
  input: DeliveryCreateInput,
): Promise<{ delivery: DeliveryDto; pregnancy: PregnancyDto }> {
  const pregnancy = await findPregnancyOrThrow(pregnancyId);
  await assertCanAppendPatient(actor, pregnancy.patientId);

  const existing = await prisma.delivery.findUnique({ where: { id: input.id } });
  if (existing) {
    if (existing.pregnancyId !== pregnancyId) {
      throw new AppError(ErrorCode.FORBIDDEN, 'This delivery id belongs to a different pregnancy');
    }
    const currentPregnancy = await findPregnancyOrThrow(pregnancyId);
    return { delivery: toDeliveryDto(existing), pregnancy: toPregnancyDto(currentPregnancy) };
  }

  if (pregnancy.status !== PregStatus.active) {
    throw new AppError(ErrorCode.RULE_VIOLATION, 'Pregnancy is not active');
  }

  const { delivery, updatedPregnancy } = await prisma.$transaction(async (tx) => {
    const createdDelivery = await tx.delivery.create({
      data: {
        id: input.id,
        pregnancyId,
        deliveredAt: new Date(input.deliveredAt),
        place: input.place,
        mode: input.mode,
        outcome: input.outcome,
        babyWeightKg: input.babyWeightKg ?? null,
        babySex: input.babySex ?? null,
        complications: input.complications,
      },
    });
    const pregnancyAfter = await tx.pregnancy.update({
      where: { id: pregnancyId },
      data: { status: PregStatus.delivered, version: { increment: 1 } },
    });
    await tx.reminder.updateMany({
      where: { pregnancyId, status: 'pending' },
      data: { status: 'cancelled' },
    });
    return { delivery: createdDelivery, updatedPregnancy: pregnancyAfter };
  });

  return { delivery: toDeliveryDto(delivery), pregnancy: toPregnancyDto(updatedPregnancy) };
}
