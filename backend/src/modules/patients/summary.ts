import type { Patient } from '../../../generated/prisma/client.js';
import { PregStatus } from '../../../generated/prisma/enums.js';
import { addDaysToDateOnly, toDateOnly } from '../../lib/dates.js';
import { prisma } from '../../lib/prisma.js';
import { type PregnancyDto, type PrescriptionDto, toPregnancyDto } from '../../lib/serializers.js';

export interface ActiveProblem {
  code: string;
  labelEn: string;
  labelNp: string;
  since: string | null;
}

export interface LastVitals {
  bpSys?: number;
  bpDia?: number;
  pulse?: number;
  tempC?: number;
  weightKg?: number;
  spo2?: number;
  at: string;
}

export interface PatientSummary {
  activeProblems: ActiveProblem[];
  currentMedicines: PrescriptionDto[];
  allergies: string[];
  lastVitals: LastVitals | null;
  activePregnancy: PregnancyDto | null;
  lastVisitAt: string | null;
  visitCount: number;
}

// REQ-PATIENT-005..007 (backend.md §9.1.1). `patient` is a raw row, not the
// DTO - this only ever runs after the caller has already confirmed the
// patient exists (findPatientOrThrow), same convention as
// maternal/service.ts's getPregnancyBundle. Reused by both
// GET /patients/:id (patients/service.ts) and POST /grants/redeem
// (grants/service.ts, REQ-GRANT-007's "same summary object").
export async function buildPatientSummary(patient: Patient): Promise<PatientSummary> {
  const visits = await prisma.visit.findMany({
    where: { patientId: patient.id, deleted: false },
    orderBy: { visitAt: 'desc' },
  });

  // REQ-PATIENT-005: distinct diagnosis codes across visits + chronicConditions,
  // joined to the diagnosis codelist. `chronicConditions` is free text at
  // creation time (patients/schemas.ts never validates it against the
  // codelist, unlike Visit's diagnosisCodes) - a chronic condition that
  // doesn't match a codelist code falls back to using the code itself as
  // its label, rather than being silently dropped.
  const earliestVisitAtByCode = new Map<string, Date>();
  for (const visit of visits) {
    for (const code of visit.diagnosisCodes as string[]) {
      const existing = earliestVisitAtByCode.get(code);
      if (!existing || visit.visitAt < existing) {
        earliestVisitAtByCode.set(code, visit.visitAt);
      }
    }
  }
  const chronicConditionCodes = patient.chronicConditions as string[];
  const allProblemCodes = [...new Set([...earliestVisitAtByCode.keys(), ...chronicConditionCodes])];
  const codeLabels =
    allProblemCodes.length > 0
      ? await prisma.codeListItem.findMany({
          where: { kind: 'diagnosis', code: { in: allProblemCodes } },
        })
      : [];
  const labelByCode = new Map(codeLabels.map((item) => [item.code, item]));
  const activeProblems: ActiveProblem[] = allProblemCodes.map((code) => {
    const label = labelByCode.get(code);
    const since = earliestVisitAtByCode.get(code);
    return {
      code,
      labelEn: label?.labelEn ?? code,
      labelNp: label?.labelNp ?? code,
      since: since ? toDateOnly(since) : null,
    };
  });

  // REQ-PATIENT-006: prescriptions still within their duration window,
  // newest first, de-duplicated by drugCode keeping the latest (visits are
  // already sorted newest-first above, so the first occurrence wins).
  const todayDateOnly = toDateOnly(new Date());
  const currentMedicinesByDrug = new Map<string, PrescriptionDto>();
  for (const visit of visits) {
    const prescriptions = visit.prescriptions as unknown as PrescriptionDto[];
    const visitDateOnly = toDateOnly(visit.visitAt);
    for (const rx of prescriptions) {
      if (currentMedicinesByDrug.has(rx.drugCode)) {
        continue;
      }
      const expiryDateOnly = addDaysToDateOnly(visitDateOnly, rx.durationDays);
      if (expiryDateOnly >= todayDateOnly) {
        currentMedicinesByDrug.set(rx.drugCode, rx);
      }
    }
  }

  // REQ-PATIENT-007: the latest visit that recorded any vitals at all - not
  // necessarily the most recent visit overall.
  const visitWithVitals = visits.find((v) => Object.keys(v.vitals as object).length > 0);
  const lastVitals: LastVitals | null = visitWithVitals
    ? {
        ...(visitWithVitals.vitals as Record<string, number>),
        at: visitWithVitals.visitAt.toISOString(),
      }
    : null;

  const activePregnancyRow = await prisma.pregnancy.findFirst({
    where: { patientId: patient.id, status: PregStatus.active, deleted: false },
  });
  let activePregnancy: PregnancyDto | null = null;
  if (activePregnancyRow) {
    const contacts = await prisma.ancContact.findMany({
      where: { pregnancyId: activePregnancyRow.id, deleted: false },
    });
    activePregnancy = toPregnancyDto(activePregnancyRow, contacts);
  }

  return {
    activeProblems,
    currentMedicines: [...currentMedicinesByDrug.values()],
    allergies: patient.allergies as string[],
    lastVitals,
    activePregnancy,
    lastVisitAt: visits[0]?.visitAt.toISOString() ?? null,
    visitCount: visits.length,
  };
}
