import { toDateOnly } from '../../lib/dates.js';
import { prisma } from '../../lib/prisma.js';
import {
  toAncContactDto,
  toDeliveryDto,
  toDocumentDto,
  toPregnancyDto,
  toVisitDto,
} from '../../lib/serializers.js';

export type TimelineBadge = 'green' | 'amber' | 'red' | null;

export interface TimelineItemDto {
  kind: 'visit' | 'document' | 'pregnancy_registered' | 'anc_contact' | 'delivery';
  at: string;
  title: string;
  subtitle: string | null;
  badge: TimelineBadge;
  refId: string;
  payload: unknown;
}

interface RawTimelineItem {
  kind: TimelineItemDto['kind'];
  at: Date;
  title: string;
  subtitle: string | null;
  badge: TimelineBadge;
  refId: string;
  payload: unknown;
}

// REQ-PATIENT-009: DocType has no codelist entry (only complaint/diagnosis/
// drug kinds are seeded, codelists/service.ts) - a small fixed English label
// map is used instead, same "server text is English, the frontend
// localises" convention as maternal/rules/triage.ts's reasons.
const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  prescription: 'Prescription',
  lab: 'Lab report',
  discharge: 'Discharge summary',
  referral: 'Referral',
  other: 'Document',
};

// REQ-PATIENT-008/009 (backend.md §9.1.2). Merges 5 independently-capped,
// per-table queries in memory rather than one SQL UNION - the same
// documented tradeoff already accepted for Facilities' Haversine search and
// Sync's pull (docs/PROJECT_PLAN.md). `before` is an exclusive cursor on
// each table's own `at` column; `limit` bounds each table's query AND the
// final merged page, so `nextBefore` only needs to check whether any single
// table was maxed out or the merge overflowed the page.
export async function buildPatientTimeline(
  patientId: string,
  before: Date | null,
  limit: number,
): Promise<{ items: TimelineItemDto[]; nextBefore: string | null }> {
  const [visits, documents, pregnancies, ancContacts, deliveries] = await Promise.all([
    prisma.visit.findMany({
      where: { patientId, deleted: false, ...(before && { visitAt: { lt: before } }) },
      orderBy: { visitAt: 'desc' },
      take: limit,
    }),
    prisma.document.findMany({
      where: { patientId, deleted: false, ...(before && { takenAt: { lt: before } }) },
      orderBy: { takenAt: 'desc' },
      take: limit,
    }),
    prisma.pregnancy.findMany({
      where: { patientId, deleted: false, ...(before && { updatedAt: { lt: before } }) },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    }),
    prisma.ancContact.findMany({
      where: {
        pregnancy: { patientId },
        deleted: false,
        doneAt: { not: null, ...(before && { lt: before }) },
      },
      orderBy: { doneAt: 'desc' },
      take: limit,
    }),
    prisma.delivery.findMany({
      where: {
        pregnancy: { patientId },
        deleted: false,
        ...(before && { deliveredAt: { lt: before } }),
      },
      orderBy: { deliveredAt: 'desc' },
      take: limit,
    }),
  ]);

  const complaintCodes = [...new Set(visits.map((v) => v.chiefComplaintCode))];
  const diagnosisCodes = [...new Set(visits.flatMap((v) => v.diagnosisCodes as string[]))];
  const [complaintLabels, diagnosisLabels] = await Promise.all([
    complaintCodes.length > 0
      ? prisma.codeListItem.findMany({ where: { kind: 'complaint', code: { in: complaintCodes } } })
      : Promise.resolve([]),
    diagnosisCodes.length > 0
      ? prisma.codeListItem.findMany({ where: { kind: 'diagnosis', code: { in: diagnosisCodes } } })
      : Promise.resolve([]),
  ]);
  const complaintLabelByCode = new Map(complaintLabels.map((c) => [c.code, c.labelEn]));
  const diagnosisLabelByCode = new Map(diagnosisLabels.map((c) => [c.code, c.labelEn]));

  const items: RawTimelineItem[] = [
    ...visits.map((visit): RawTimelineItem => {
      const vitals = visit.vitals as Record<string, unknown>;
      const [firstDiagnosisCode] = visit.diagnosisCodes as string[];
      const diagnosisLabel = firstDiagnosisCode
        ? (diagnosisLabelByCode.get(firstDiagnosisCode) ?? firstDiagnosisCode)
        : 'no diagnosis recorded';
      const complaintLabel =
        complaintLabelByCode.get(visit.chiefComplaintCode) ?? visit.chiefComplaintCode;
      return {
        kind: 'visit',
        at: visit.visitAt,
        // Self-reported visits have no facility (facilityName is null by
        // design, resolveVisitProviderInfo in visits/service.ts) - fall
        // back to providerName ("Self-reported") rather than showing a
        // blank facility.
        title: `Visit — ${visit.facilityName ?? visit.providerName} — ${diagnosisLabel}`,
        subtitle: `${complaintLabel} · BP ${vitals.bpSys ?? '-'}/${vitals.bpDia ?? '-'}`,
        badge: null,
        refId: visit.id,
        payload: toVisitDto(visit),
      };
    }),
    ...documents.map(
      (document): RawTimelineItem => ({
        kind: 'document',
        at: document.takenAt,
        title: `${DOCUMENT_TYPE_LABELS[document.type] ?? document.type}: ${document.title}`,
        subtitle: null,
        badge: null,
        refId: document.id,
        payload: toDocumentDto(document),
      }),
    ),
    ...pregnancies.map(
      (pregnancy): RawTimelineItem => ({
        kind: 'pregnancy_registered',
        at: pregnancy.updatedAt,
        title: 'Pregnancy registered',
        subtitle: `EDD ${toDateOnly(pregnancy.edd)}`,
        badge: null,
        refId: pregnancy.id,
        payload: toPregnancyDto(pregnancy),
      }),
    ),
    ...ancContacts.map((contact): RawTimelineItem => {
      const findings = contact.findings as Record<string, unknown> | null;
      const bpSys = findings?.bpSys ?? '-';
      const bpDia = findings?.bpDia ?? '-';
      const hb = findings?.hbGdl ?? '-';
      const referred = contact.referral !== null;
      return {
        kind: 'anc_contact',
        at: contact.doneAt as Date,
        title: `ANC contact ${contact.contactNo} (week ${contact.weekTarget})`,
        subtitle: `BP ${bpSys}/${bpDia} · Hb ${hb}${referred ? ' · referred' : ''}`,
        badge: contact.triageLevel as TimelineBadge,
        refId: contact.id,
        payload: toAncContactDto(contact),
      };
    }),
    ...deliveries.map(
      (delivery): RawTimelineItem => ({
        kind: 'delivery',
        at: delivery.deliveredAt,
        title: `Delivery — ${delivery.place}`,
        subtitle: `${delivery.outcome}, ${delivery.babyWeightKg ?? '-'} kg`,
        badge: null,
        refId: delivery.id,
        payload: toDeliveryDto(delivery),
      }),
    ),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const page = items.slice(0, limit);
  const anyTableMaxedOut = [visits, documents, pregnancies, ancContacts, deliveries].some(
    (rows) => rows.length === limit,
  );
  const hasMore = anyTableMaxedOut || items.length > limit;
  const lastItem = page[page.length - 1];
  const nextBefore = hasMore && lastItem ? lastItem.at.toISOString() : null;

  return {
    items: page.map(({ at, ...rest }) => ({ ...rest, at: at.toISOString() })),
    nextBefore,
  };
}
