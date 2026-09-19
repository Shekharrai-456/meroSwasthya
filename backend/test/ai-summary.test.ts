import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Role } from '../generated/prisma/enums.js';
import { prisma } from '../src/lib/prisma.js';
import type {
  VisionSummaryClient,
  VisionSummaryResult,
} from '../src/modules/documents/ai/client.js';
import { processAiSummaryJob } from '../src/modules/documents/ai/service.js';
import type { DocumentStorage } from '../src/modules/documents/storage.js';
import { resetDb, resetRedis } from './helpers/db.js';

// REQ-DOC-007. Real Postgres throughout (CLAUDE.md §10). `processAiSummaryJob`
// is tested directly with a fake VisionSummaryClient and DocumentStorage - no
// BullMQ/worker infrastructure or a real Anthropic API key needed, since
// worker.ts is a thin wrapper around this same function (same precedent as
// test/reminders.test.ts's processPendingReminders).

function fakeStorage(): DocumentStorage {
  return {
    presignUpload: async () => 'unused',
    presignDownload: async () => 'unused',
    headObject: async () => ({ exists: true, contentLength: 123 }),
    downloadObject: async () => ({
      buffer: Buffer.from('fake-jpeg-bytes'),
      contentType: 'image/jpeg',
    }),
  };
}

function fakeClient(behavior: () => Promise<VisionSummaryResult>): VisionSummaryClient {
  return { summarize: behavior };
}

async function createUploadedDocument(overrides: Record<string, unknown> = {}) {
  const user = await prisma.user.create({
    data: { phone: `+97798${Math.floor(Math.random() * 1e8)}`, role: Role.patient, name: 'X' },
  });
  const patient = await prisma.patient.create({
    data: {
      id: randomUUID(),
      ownerUserId: user.id,
      name: 'Test Patient',
      sex: 'female',
      dob: new Date('2000-01-01'),
    },
  });
  return prisma.document.create({
    data: {
      id: randomUUID(),
      patientId: patient.id,
      uploadedByUserId: user.id,
      type: 'prescription',
      title: 'Test doc',
      takenAt: new Date('2026-09-01'),
      status: 'uploaded',
      objectKey: `patients/${patient.id}/doc.jpg`,
      contentType: 'image/jpeg',
      aiSummaryStatus: 'queued',
      ...overrides,
    },
  });
}

describe('processAiSummaryJob (REQ-DOC-007)', () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
  });

  it('downloads the object, calls the vision client, and stores a formatted summary with status done', async () => {
    const document = await createUploadedDocument();
    const client = fakeClient(async () => ({
      summaryEn: 'Paracetamol prescribed for fever.',
      summaryNp: 'ज्वरोको लागि प्यारासिटामोल तोकिएको।',
      medicines: ['Paracetamol 500mg'],
    }));

    await processAiSummaryJob(document.id, fakeStorage(), client);

    const updated = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    expect(updated.aiSummaryStatus).toBe('done');
    expect(updated.aiSummary).toContain('Paracetamol prescribed for fever.');
    expect(updated.aiSummary).toContain('ज्वरोको लागि प्यारासिटामोल तोकिएको।');
    expect(updated.aiSummary).toContain('Medicines: Paracetamol 500mg');
    expect(updated.aiSummary).toContain('AI draft — verify');
  });

  it('shows "none identified" when no medicines are found', async () => {
    const document = await createUploadedDocument();
    const client = fakeClient(async () => ({
      summaryEn: 'Blood test results, all normal.',
      summaryNp: 'रगत जाँचको नतिजा सामान्य छ।',
      medicines: [],
    }));

    await processAiSummaryJob(document.id, fakeStorage(), client);

    const updated = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    expect(updated.aiSummary).toContain('Medicines: none identified');
  });

  it('sets status to failed when the vision client throws', async () => {
    const document = await createUploadedDocument();
    const client = fakeClient(async () => {
      throw new Error('Anthropic API error: 500 internal error');
    });

    await processAiSummaryJob(document.id, fakeStorage(), client);

    const updated = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    expect(updated.aiSummaryStatus).toBe('failed');
    expect(updated.aiSummary).toBeNull();
  });

  it('sets status to failed when the storage download fails', async () => {
    const document = await createUploadedDocument();
    const brokenStorage: DocumentStorage = {
      ...fakeStorage(),
      downloadObject: async () => {
        throw new Error('object not found');
      },
    };
    const client = fakeClient(async () => ({ summaryEn: 'x', summaryNp: 'y', medicines: [] }));

    await processAiSummaryJob(document.id, brokenStorage, client);

    const updated = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    expect(updated.aiSummaryStatus).toBe('failed');
  });

  it('is a no-op when the document no longer exists', async () => {
    const client = fakeClient(async () => ({ summaryEn: 'x', summaryNp: 'y', medicines: [] }));
    await expect(processAiSummaryJob(randomUUID(), fakeStorage(), client)).resolves.toBeUndefined();
  });
});
