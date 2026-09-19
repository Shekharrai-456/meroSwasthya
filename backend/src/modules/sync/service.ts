import { ZodError } from 'zod';
import { AppError, ErrorCode } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import {
  toAncContactDto,
  toDeliveryDto,
  toDocumentDto,
  toPatientDto,
  toPregnancyDto,
  toVisitDto,
} from '../../lib/serializers.js';
import { assertCanAppendPatient, type AuthenticatedUser } from '../../plugins/auth.js';
import { documentMetadataUpdateSchema } from '../documents/schemas.js';
import { s3Storage } from '../documents/storage.js';
import { updateDocumentMetadata } from '../documents/service.js';
import {
  createPregnancy,
  findPregnancyOrThrow,
  recordContact,
  recordDelivery,
  updatePregnancy,
} from '../maternal/service.js';
import {
  contactRecordSchema,
  deliveryCreateSchema,
  pregnancyCreateSchema,
  pregnancyUpdateSchema,
} from '../maternal/schemas.js';
import { createPatient, updatePatient } from '../patients/service.js';
import { patientCreateSchema, patientUpdateSchema } from '../patients/schemas.js';
import { createVisit } from '../visits/service.js';
import { visitCreateSchema } from '../visits/schemas.js';
import type { SyncChangeInput, SyncPullQuery, SyncPushInput } from './schemas.js';

// REQ-SYNC-001..008. Reuses the exact same per-entity service functions the
// REST endpoints call (createPatient/updatePatient, createVisit,
// createPregnancy/updatePregnancy/recordContact/recordDelivery) rather than
// re-implementing their business rules - REQ-SYNC-006/007's "recomputes
// triage exactly as the PUT endpoint does" / "runs the same creation logic
// as POST" are satisfied by construction, not by keeping two copies in sync.

interface ChangeOutcome {
  status: 'applied' | 'conflict' | 'rejected';
  row?: unknown;
  current?: unknown;
  error?: { code: string; message: string };
}

export interface SyncChangeResult {
  opId: string;
  status: 'applied' | 'duplicate' | 'conflict' | 'rejected';
  row?: unknown;
  current?: unknown;
  error?: { code: string; message: string };
}

function requireStringField(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `payload.${field} is required`, [
      { field, message: 'required' },
    ]);
  }
  return value;
}

async function applyPatientChange(
  actor: AuthenticatedUser,
  change: SyncChangeInput,
): Promise<ChangeOutcome> {
  const existing = await prisma.patient.findUnique({ where: { id: change.rowId } });
  if (!existing) {
    const input = patientCreateSchema.parse({ ...change.payload, id: change.rowId });
    const created = await createPatient(actor, input);
    return { status: 'applied', row: created };
  }
  if (existing.version !== change.baseVersion) {
    return { status: 'conflict', current: toPatientDto(existing) };
  }
  const input = patientUpdateSchema.parse({ ...change.payload, version: change.baseVersion });
  const updated = await updatePatient(actor, change.rowId, input);
  return { status: 'applied', row: updated };
}

// Append-only (REQ-SYNC-004): createVisit already implements "existing id ->
// idempotent return; otherwise create" and its own canAppend/role checks -
// reused as-is, no separate existence/version check needed here.
async function applyVisitChange(
  actor: AuthenticatedUser,
  change: SyncChangeInput,
): Promise<ChangeOutcome> {
  const payload = change.payload as Record<string, unknown>;
  const patientId = requireStringField(payload, 'patientId');
  const { patientId: _drop, ...rest } = payload;
  const input = visitCreateSchema.parse({ ...rest, id: change.rowId });
  const visit = await createVisit(actor, patientId, input);
  return { status: 'applied', row: visit };
}

async function applyPregnancyChange(
  actor: AuthenticatedUser,
  change: SyncChangeInput,
): Promise<ChangeOutcome> {
  const payload = change.payload as Record<string, unknown>;
  const existing = await prisma.pregnancy.findUnique({ where: { id: change.rowId } });
  if (!existing) {
    const patientId = requireStringField(payload, 'patientId');
    const { patientId: _drop, ...rest } = payload;
    const input = pregnancyCreateSchema.parse({ ...rest, id: change.rowId });
    const result = await createPregnancy(actor, patientId, input);
    return { status: 'applied', row: result.pregnancy };
  }
  if (existing.version !== change.baseVersion) {
    return { status: 'conflict', current: toPregnancyDto(existing) };
  }
  const input = pregnancyUpdateSchema.parse({ ...payload, version: change.baseVersion });
  const updated = await updatePregnancy(actor, change.rowId, input);
  return { status: 'applied', row: updated };
}

// REQ-SYNC-006: an existing contact's update always recomputes triage via
// `recordContact`, the same function PUT .../contacts/:no calls.
//
// A not-yet-existing contact is only allowed if its pregnancy already
// exists (backend.md §9.7's literal wording) - it's created as a stub first
// (matching what createPregnancy's own cascade would have produced), then,
// if the payload already carries a completed contact (an offline provider
// finished the whole visit before ever syncing), immediately recorded via
// the same `recordContact` path. These are two separate writes, not one
// transaction - a documented, narrow gap (see docs/PROGRESS.md's Session 12
// entry): a crash between them would leave the stub created but unrecorded,
// recoverable by the client re-sending the same change (a fresh opId, since
// the first one's stored result would otherwise just replay as a stub).
async function applyAncContactChange(
  actor: AuthenticatedUser,
  change: SyncChangeInput,
): Promise<ChangeOutcome> {
  const payload = change.payload as Record<string, unknown>;
  const pregnancyId = requireStringField(payload, 'pregnancyId');
  const contactNoRaw = payload.contactNo;
  if (typeof contactNoRaw !== 'number') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'payload.contactNo is required', [
      { field: 'contactNo', message: 'required' },
    ]);
  }
  const contactNo = contactNoRaw;

  const existing = await prisma.ancContact.findUnique({ where: { id: change.rowId } });
  if (!existing) {
    const pregnancy = await findPregnancyOrThrow(pregnancyId);
    await assertCanAppendPatient(actor, pregnancy.patientId);
    const weekTarget = payload.weekTarget;
    const dueAt = payload.dueAt;
    if (typeof weekTarget !== 'number' || typeof dueAt !== 'string') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'payload.weekTarget/dueAt are required', [
        { field: 'weekTarget', message: 'required' },
      ]);
    }
    await prisma.ancContact.create({
      data: { id: change.rowId, pregnancyId, contactNo, weekTarget, dueAt: new Date(dueAt) },
    });
    if (typeof payload.doneAt === 'string') {
      const input = contactRecordSchema.parse(payload);
      const result = await recordContact(actor, pregnancyId, contactNo, input);
      return { status: 'applied', row: result.ancContact };
    }
    const created = await prisma.ancContact.findUniqueOrThrow({ where: { id: change.rowId } });
    return { status: 'applied', row: toAncContactDto(created) };
  }

  if (existing.version !== change.baseVersion) {
    return { status: 'conflict', current: toAncContactDto(existing) };
  }
  const input = contactRecordSchema.parse(payload);
  const result = await recordContact(actor, pregnancyId, contactNo, input);
  return { status: 'applied', row: result.ancContact };
}

// Append-only (REQ-SYNC-004), same reuse pattern as visits.
async function applyDeliveryChange(
  actor: AuthenticatedUser,
  change: SyncChangeInput,
): Promise<ChangeOutcome> {
  const payload = change.payload as Record<string, unknown>;
  const pregnancyId = requireStringField(payload, 'pregnancyId');
  const { pregnancyId: _drop, ...rest } = payload;
  const input = deliveryCreateSchema.parse({ ...rest, id: change.rowId });
  const result = await recordDelivery(actor, pregnancyId, input);
  return { status: 'applied', row: result.delivery };
}

// REQ-SYNC-003: "documents -> canAppend, meta only". Update-only, not
// create+upload - a presigned upload URL's 15-minute TTL is fundamentally
// incompatible with outbox-style store-and-forward queuing (a client could
// sit offline for hours), so document creation always goes through the
// real-time `POST /documents/presign` REST call (REQ-SYNC-019's own
// documented "presign -> PUT bytes -> complete" sequence), never sync. A
// change for a not-yet-existing document is rejected with a message
// pointing at that endpoint, rather than silently accepted and left in a
// permanently un-uploadable state.
async function applyDocumentChange(
  actor: AuthenticatedUser,
  change: SyncChangeInput,
): Promise<ChangeOutcome> {
  const existing = await prisma.document.findUnique({ where: { id: change.rowId } });
  if (!existing) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      'Documents cannot be created via sync - use POST /documents/presign',
      [{ field: 'rowId', message: 'document does not exist' }],
    );
  }
  if (existing.version !== change.baseVersion) {
    return { status: 'conflict', current: toDocumentDto(existing) };
  }
  const input = documentMetadataUpdateSchema.parse({
    ...change.payload,
    version: change.baseVersion,
  });
  const updated = await updateDocumentMetadata(actor, change.rowId, input);
  return { status: 'applied', row: updated };
}

async function applyChange(
  actor: AuthenticatedUser,
  change: SyncChangeInput,
): Promise<ChangeOutcome> {
  switch (change.table) {
    case 'patients':
      return applyPatientChange(actor, change);
    case 'visits':
      return applyVisitChange(actor, change);
    case 'pregnancies':
      return applyPregnancyChange(actor, change);
    case 'anc_contacts':
      return applyAncContactChange(actor, change);
    case 'deliveries':
      return applyDeliveryChange(actor, change);
    case 'documents':
      return applyDocumentChange(actor, change);
    default:
      // Unreachable: `table` is already a zod enum of exactly these 6
      // values (schemas.ts's SYNCABLE_TABLES) - kept for exhaustiveness.
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Unknown table');
  }
}

// REQ-SYNC-008: a thrown VERSION_CONFLICT becomes `conflict`; any other
// AppError becomes `rejected` with its own code/message; a zod failure on
// the payload becomes `rejected VALIDATION_ERROR`. Anything else (a real
// programming error) is rethrown, not swallowed as a fake rejection.
function mapErrorToOutcome(err: unknown): ChangeOutcome {
  if (err instanceof AppError) {
    if (err.code === ErrorCode.VERSION_CONFLICT) {
      const details = err.details as { current?: unknown } | undefined;
      return { status: 'conflict', current: details?.current };
    }
    return { status: 'rejected', error: { code: err.code, message: err.message } };
  }
  if (err instanceof ZodError) {
    return {
      status: 'rejected',
      error: { code: ErrorCode.VALIDATION_ERROR, message: 'Validation failed' },
    };
  }
  throw err;
}

// REQ-SYNC-002: de-dupes by opId, replaying the stored outcome (status
// always "duplicate" on replay, per docs/REQUIREMENTS.md's REQ-SYNC-002
// wording - not whatever the original status was).
export async function pushChange(
  actor: AuthenticatedUser,
  deviceId: string,
  change: SyncChangeInput,
): Promise<SyncChangeResult> {
  const existingOp = await prisma.syncOp.findUnique({ where: { opId: change.opId } });
  if (existingOp) {
    const stored = existingOp.resultJson as { row?: unknown; current?: unknown; error?: unknown };
    return {
      opId: change.opId,
      status: 'duplicate',
      row: stored.row ?? undefined,
      current: stored.current ?? undefined,
      error: stored.error as SyncChangeResult['error'],
    };
  }

  let outcome: ChangeOutcome;
  try {
    outcome = await applyChange(actor, change);
  } catch (err) {
    outcome = mapErrorToOutcome(err);
  }

  await prisma.syncOp.create({
    data: {
      opId: change.opId,
      deviceId,
      userId: actor.id,
      status: outcome.status,
      resultJson: {
        row: (outcome.row ?? null) as object | null,
        current: (outcome.current ?? null) as object | null,
        error: (outcome.error ?? null) as object | null,
      },
    },
  });

  return { opId: change.opId, ...outcome };
}

// REQ-SYNC-001: up to 50 changes, each independently applied - one change's
// failure never aborts the batch.
export async function pushBatch(
  actor: AuthenticatedUser,
  input: SyncPushInput,
): Promise<{ results: SyncChangeResult[]; serverTime: string }> {
  const results: SyncChangeResult[] = [];
  for (const change of input.changes) {
    results.push(await pushChange(actor, input.deviceId, change));
  }
  return { results, serverTime: new Date().toISOString() };
}

const PULL_PAGE_SIZE = 200;

// REQ-SYNC-009..011. Merges 5 small, independently-capped query results
// (bounded exactly like Facilities' Haversine sort - see its own comment)
// rather than one SQL UNION, since none of these tables are large at this
// project's scale. `since` defaults to the epoch (pull everything) when
// omitted. Soft-deleted rows are NOT filtered out - REQ-SYNC-011 requires
// them returned with `deleted:true` (currently moot in practice: nothing in
// this codebase ever sets it, per docs/REQUIREMENTS.md's GAPS G3 - kept for
// contract completeness regardless).
export async function pullChanges(
  actor: AuthenticatedUser,
  query: SyncPullQuery,
): Promise<{ changes: { table: string; row: unknown }[]; cursor: string; hasMore: boolean }> {
  const since = query.since ? new Date(query.since) : new Date(0);

  const grants = await prisma.accessGrant.findMany({
    where: { redeemedByUserId: actor.id, revokedAt: null, accessUntil: { gt: new Date() } },
    select: { patientId: true },
    distinct: ['patientId'],
  });
  const grantedIds = grants.map((g) => g.patientId);
  const accessiblePatients = await prisma.patient.findMany({
    where: { OR: [{ ownerUserId: actor.id }, { id: { in: grantedIds } }] },
    select: { id: true },
  });
  const patientIds = accessiblePatients.map((p) => p.id);

  if (patientIds.length === 0) {
    return { changes: [], cursor: query.since ?? since.toISOString(), hasMore: false };
  }

  const [patients, visits, pregnancies, ancContacts, deliveries, documents] = await Promise.all([
    prisma.patient.findMany({
      where: { id: { in: patientIds }, updatedAt: { gt: since } },
      orderBy: { updatedAt: 'asc' },
      take: PULL_PAGE_SIZE,
    }),
    prisma.visit.findMany({
      where: { patientId: { in: patientIds }, updatedAt: { gt: since } },
      orderBy: { updatedAt: 'asc' },
      take: PULL_PAGE_SIZE,
    }),
    prisma.pregnancy.findMany({
      where: { patientId: { in: patientIds }, updatedAt: { gt: since } },
      orderBy: { updatedAt: 'asc' },
      take: PULL_PAGE_SIZE,
    }),
    prisma.ancContact.findMany({
      where: { pregnancy: { patientId: { in: patientIds } }, updatedAt: { gt: since } },
      orderBy: { updatedAt: 'asc' },
      take: PULL_PAGE_SIZE,
    }),
    prisma.delivery.findMany({
      where: { pregnancy: { patientId: { in: patientIds } }, updatedAt: { gt: since } },
      orderBy: { updatedAt: 'asc' },
      take: PULL_PAGE_SIZE,
    }),
    prisma.document.findMany({
      where: { patientId: { in: patientIds }, updatedAt: { gt: since }, deleted: false },
      orderBy: { updatedAt: 'asc' },
      take: PULL_PAGE_SIZE,
    }),
  ]);

  const anyTableMaxedOut = [patients, visits, pregnancies, ancContacts, deliveries, documents].some(
    (rows) => rows.length === PULL_PAGE_SIZE,
  );

  // backend.md §9.7: "documents: include downloadUrl when uploaded" - signed
  // per-row rather than reusing documents/service.ts's getDocument (which is
  // canRead-gated per-document; access here is already proven at the
  // patientIds/accessiblePatients level above).
  const documentRows = await Promise.all(
    documents.map(async (d) => ({
      table: 'documents',
      row: toDocumentDto(
        d,
        d.status === 'uploaded' ? await s3Storage.presignDownload(d.objectKey) : null,
      ),
      updatedAt: d.updatedAt,
    })),
  );

  const merged = [
    ...patients.map((r) => ({ table: 'patients', row: toPatientDto(r), updatedAt: r.updatedAt })),
    ...visits.map((r) => ({ table: 'visits', row: toVisitDto(r), updatedAt: r.updatedAt })),
    ...pregnancies.map((r) => ({
      table: 'pregnancies',
      row: toPregnancyDto(r),
      updatedAt: r.updatedAt,
    })),
    ...ancContacts.map((r) => ({
      table: 'anc_contacts',
      row: toAncContactDto(r),
      updatedAt: r.updatedAt,
    })),
    ...deliveries.map((r) => ({
      table: 'deliveries',
      row: toDeliveryDto(r),
      updatedAt: r.updatedAt,
    })),
    ...documentRows,
  ].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());

  const page = merged.slice(0, PULL_PAGE_SIZE);
  const hasMore = anyTableMaxedOut || merged.length > PULL_PAGE_SIZE;
  const cursor =
    page.length > 0
      ? (page[page.length - 1]?.updatedAt.toISOString() ?? since.toISOString())
      : (query.since ?? since.toISOString());

  return {
    changes: page.map(({ table, row }) => ({ table, row })),
    cursor,
    hasMore,
  };
}
