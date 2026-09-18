import { AuditAction } from '../../../generated/prisma/enums.js';
import { prisma } from '../../lib/prisma.js';
import { type AuditDto, toAuditDto } from '../../lib/serializers.js';
import type { AuthenticatedUser } from '../../plugins/auth.js';

// REQ-AUDIT-001/002/003. No routes.ts by design (docs/ARCHITECTURE.md's
// directory tree) - audit is written by other modules' service code as a
// side effect of their own actions, and read only via
// GET /patients/:id/audit (modules/patients/routes.ts).

export interface LogAuditInput {
  patientId: string;
  actor: AuthenticatedUser & { name: string; facilityName: string | null };
  action: AuditAction;
  grantId?: string | null;
}

export async function logAudit(input: LogAuditInput): Promise<void> {
  await prisma.auditEntry.create({
    data: {
      patientId: input.patientId,
      actorUserId: input.actor.id,
      actorName: input.actor.name,
      actorFacilityName: input.actor.facilityName,
      action: input.action,
      grantId: input.grantId ?? null,
    },
  });
}

// REQ-ROLE-006: at most one record_viewed audit row per (actor, patient)
// every 10 minutes - queries the audit table's own recent rows rather than a
// separate counter, since AuditEntry already carries everything needed.
const RECORD_VIEWED_THROTTLE_MS = 10 * 60 * 1000;

export async function wasRecentlyViewed(actorUserId: string, patientId: string): Promise<boolean> {
  const recent = await prisma.auditEntry.findFirst({
    where: {
      patientId,
      actorUserId,
      action: AuditAction.record_viewed,
      at: { gt: new Date(Date.now() - RECORD_VIEWED_THROTTLE_MS) },
    },
    select: { id: true },
  });
  return recent !== null;
}

// REQ-PATIENT-010: owner-only (enforced by the caller, modules/patients/
// routes.ts), newest-first per the @@index([patientId, at]).
export async function getAuditForPatient(patientId: string): Promise<AuditDto[]> {
  const entries = await prisma.auditEntry.findMany({
    where: { patientId },
    orderBy: { at: 'desc' },
  });
  return entries.map(toAuditDto);
}
