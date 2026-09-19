import { AuditAction } from '../../../generated/prisma/enums.js';
import { config } from '../../config.js';
import { AppError, ErrorCode } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { type DocumentDto, toDocumentDto } from '../../lib/serializers.js';
import {
  type AuthenticatedUser,
  assertCanAppendPatient,
  assertCanReadPatient,
  getActorAuditInfo,
} from '../../plugins/auth.js';
import { logAudit } from '../audit/service.js';
import { enqueueAiSummaryJob } from './ai/worker.js';
import type { DocumentMetadataUpdateInput, DocumentPresignInput } from './schemas.js';
import { buildObjectKey, type DocumentStorage, s3Storage } from './storage.js';

async function findPatientOrThrow(patientId: string) {
  const patient = await prisma.patient.findFirst({ where: { id: patientId, deleted: false } });
  if (!patient) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Patient not found');
  }
  return patient;
}

export async function findDocumentOrThrow(documentId: string) {
  const document = await prisma.document.findFirst({ where: { id: documentId, deleted: false } });
  if (!document) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Document not found');
  }
  return document;
}

// REQ-DOC-001/002: canAppendPatient, size/content-type already validated by
// the zod schema; idempotent on the client-generated id (same convention as
// Visits/Patients) - a repeat presign for an existing id just re-signs a
// fresh upload URL for the same object key rather than erroring, since a
// client might legitimately retry a presign call whose response it never
// received.
export async function presignDocument(
  actor: AuthenticatedUser,
  input: DocumentPresignInput,
  storage: DocumentStorage = s3Storage,
): Promise<{
  document: DocumentDto;
  uploadUrl: string;
  uploadMethod: 'PUT';
  uploadHeaders: Record<string, string>;
  expiresInSec: number;
}> {
  const patient = await findPatientOrThrow(input.patientId);
  await assertCanAppendPatient(actor, patient.id);

  const existing = await prisma.document.findUnique({ where: { id: input.id } });
  const objectKey = buildObjectKey(input.patientId, input.id);

  let document = existing;
  if (!document) {
    document = await prisma.document.create({
      data: {
        id: input.id,
        patientId: input.patientId,
        uploadedByUserId: actor.id,
        type: input.type,
        title: input.title,
        takenAt: new Date(input.takenAt),
        objectKey,
        contentType: input.contentType,
      },
    });
  } else if (document.patientId !== input.patientId) {
    throw new AppError(ErrorCode.FORBIDDEN, 'This document id belongs to a different patient');
  }

  const uploadUrl = await storage.presignUpload(objectKey, input.contentType);

  return {
    document: toDocumentDto(document),
    uploadUrl,
    uploadMethod: 'PUT',
    uploadHeaders: { 'Content-Type': input.contentType },
    expiresInSec: 15 * 60,
  };
}

// REQ-DOC-004: HEAD the object; only then flip status -> uploaded and audit.
// A client that calls /complete before the PUT actually finished gets a
// clean, actionable rejection instead of a false "uploaded" status.
export async function completeDocument(
  actor: AuthenticatedUser,
  documentId: string,
  storage: DocumentStorage = s3Storage,
): Promise<DocumentDto> {
  const document = await findDocumentOrThrow(documentId);
  await assertCanAppendPatient(actor, document.patientId);

  const head = await storage.headObject(document.objectKey);
  if (!head.exists) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Upload has not completed yet', [
      { field: 'id', message: 'object not found in storage' },
    ]);
  }

  const updated = await prisma.document.update({
    where: { id: documentId },
    data: { status: 'uploaded', version: { increment: 1 } },
  });

  const { name, facilityName } = await getActorAuditInfo(actor.id);
  await logAudit({
    patientId: document.patientId,
    actor: { ...actor, name, facilityName },
    action: AuditAction.document_added,
  });

  const downloadUrl = await storage.presignDownload(document.objectKey);
  return toDocumentDto(updated, downloadUrl);
}

// REQ-DOC-005: canRead-gated (checked here, unlike Visits/Maternal's
// existence-then-access-in-the-route convention, since there's only one
// read path for a Document and no list endpoint to share the helper with).
export async function getDocument(
  actor: AuthenticatedUser,
  documentId: string,
  storage: DocumentStorage = s3Storage,
): Promise<DocumentDto> {
  const document = await findDocumentOrThrow(documentId);
  await assertCanReadPatient(actor, document.patientId);
  const downloadUrl =
    document.status === 'uploaded' ? await storage.presignDownload(document.objectKey) : null;
  return toDocumentDto(document, downloadUrl);
}

// REQ-SYNC-003: metadata-only update, reused by sync/service.ts's
// `applyDocumentChange` - never touches `status`/`objectKey`/`aiSummary*`.
export async function updateDocumentMetadata(
  actor: AuthenticatedUser,
  documentId: string,
  input: DocumentMetadataUpdateInput,
): Promise<DocumentDto> {
  const document = await findDocumentOrThrow(documentId);
  await assertCanAppendPatient(actor, document.patientId);
  if (document.version !== input.version) {
    throw new AppError(ErrorCode.VERSION_CONFLICT, 'Document was updated by someone else', {
      current: toDocumentDto(document),
    });
  }
  const updated = await prisma.document.update({
    where: { id: documentId },
    data: {
      ...(input.type !== undefined && { type: input.type }),
      ...(input.title !== undefined && { title: input.title }),
      ...(input.takenAt !== undefined && { takenAt: new Date(input.takenAt) }),
      version: { increment: 1 },
    },
  });
  return toDocumentDto(updated);
}

// REQ-DOC-006/007: 501 when AI_MODE=off. Otherwise flips aiSummaryStatus to
// queued and enqueues the real ai-summary job (documents/ai/{client,service,
// worker}.ts) - the worker downloads the object, calls the vision LLM, and
// sets status to done/failed asynchronously. `enqueue` is an injectable
// param (default: the real BullMQ producer) purely so tests can assert a
// job was requested without needing a live Redis/BullMQ connection at the
// HTTP layer - the same seam `storage` already provides for S3.
export async function summarizeDocument(
  actor: AuthenticatedUser,
  documentId: string,
  enqueue: (documentId: string) => Promise<void> = enqueueAiSummaryJob,
): Promise<DocumentDto> {
  const document = await findDocumentOrThrow(documentId);
  await assertCanReadPatient(actor, document.patientId);

  if (config.AI_MODE === 'off') {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, 'AI summarisation is not enabled');
  }
  if (document.status !== 'uploaded') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Document has not finished uploading yet', [
      { field: 'id', message: 'document is not uploaded' },
    ]);
  }

  const updated = await prisma.document.update({
    where: { id: documentId },
    data: { aiSummaryStatus: 'queued' },
  });
  await enqueue(documentId);
  return toDocumentDto(updated);
}
