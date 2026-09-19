import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GrantScope, Role } from '../generated/prisma/enums.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { prisma } from '../src/lib/prisma.js';
import {
  completeDocument,
  getDocument,
  summarizeDocument,
  updateDocumentMetadata,
} from '../src/modules/documents/service.js';
import type { DocumentStorage } from '../src/modules/documents/storage.js';
import { asUser, testClient } from './helpers/client.js';
import { resetDb, resetRedis } from './helpers/db.js';

// REQ-DOC-001..008. Real Postgres + Redis throughout (CLAUDE.md §10).
//
// POST /documents/presign and GET /documents/:id (while pending_upload) never
// reach the network - presigning a URL is pure local signing, and a pending
// document's GET never calls storage at all - so those are exercised through
// real HTTP against the real s3Storage. POST /documents/:id/complete over
// real HTTP is also exercised for its failure path: headObject's real network
// call to S3_ENDPOINT (no live MinIO in this environment, see
// docs/TECH_DECISIONS.md's "Session 13 update") deterministically fails,
// which storage.ts's own try/catch turns into `exists: false` - a real,
// reproducible "upload has not completed yet" 422. The success paths that
// require a live object actually existing (complete -> uploaded, a fresh
// downloadUrl) are exercised by calling the service functions directly with
// a fake DocumentStorage, the same precedent reminders.test.ts established
// for SmsAdapter.

// A real JPEG SOI marker (0xFF 0xD8 0xFF) followed by arbitrary bytes -
// `completeDocument`'s magic-byte check (Phase 10 hardening) only looks at
// these first 3 bytes, so this is enough to look like a real JPEG without
// needing an actual image fixture.
const FAKE_JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function fakeStorage(overrides: Partial<DocumentStorage> = {}): DocumentStorage {
  return {
    presignUpload: async (key) => `https://fake-s3.test/${key}?upload=1`,
    presignDownload: async (key) => `https://fake-s3.test/${key}?download=1`,
    headObject: async () => ({ exists: true, contentLength: FAKE_JPEG_BYTES.length }),
    downloadObject: async () => ({
      buffer: FAKE_JPEG_BYTES,
      contentType: 'image/jpeg',
    }),
    ...overrides,
  };
}

function samplePatientPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    name: 'Sita Chaudhary',
    sex: 'female',
    dob: '2002-03-15',
    allergies: [],
    chronicConditions: [],
    ...overrides,
  };
}

function samplePresignBody(patientId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    patientId,
    type: 'prescription',
    title: 'Dr Sharma prescription',
    takenAt: '2026-09-18',
    contentType: 'image/jpeg',
    sizeBytes: 500_000,
    ...overrides,
  };
}

async function createGrant(
  patientId: string,
  redeemedByUserId: string,
  opts: { scope?: GrantScope; expired?: boolean; revoked?: boolean } = {},
) {
  return prisma.accessGrant.create({
    data: {
      patientId,
      scope: opts.scope ?? GrantScope.append,
      tokenJti: randomUUID(),
      expiresAt: new Date(Date.now() + 600_000),
      redeemedByUserId,
      redeemedAt: new Date(),
      accessUntil: opts.expired ? new Date(Date.now() - 1000) : new Date(Date.now() + 86_400_000),
      revokedAt: opts.revoked ? new Date() : null,
    },
  });
}

describe('documents module', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb();
    await resetRedis();
  });

  describe('POST /api/v1/documents/presign (REQ-DOC-001/002/003)', () => {
    it('requires authentication', async () => {
      const client = testClient(app);
      const res = await client.post('/api/v1/documents/presign', samplePresignBody(randomUUID()));
      expect(res.statusCode).toBe(401);
    });

    it('rejects a non-jpeg content type with a 400 (schema validation, matches every other module)', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post('/api/v1/patients', samplePatientPayload());
      const patientId = patientRes.json().data.patient.id;
      const res = await owner.post(
        '/api/v1/documents/presign',
        samplePresignBody(patientId, { contentType: 'image/png' }),
      );
      expect(res.statusCode).toBe(400);
    });

    it('rejects a file over 2 MB with a 400 (schema validation)', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post('/api/v1/patients', samplePatientPayload());
      const patientId = patientRes.json().data.patient.id;
      const res = await owner.post(
        '/api/v1/documents/presign',
        samplePresignBody(patientId, { sizeBytes: 3 * 1024 * 1024 }),
      );
      expect(res.statusCode).toBe(400);
    });

    it('rejects a provider with no grant on the patient (403)', async () => {
      const owner = await asUser(app, Role.patient);
      const stranger = await asUser(app, Role.provider);
      const patientRes = await owner.post('/api/v1/patients', samplePatientPayload());
      const patientId = patientRes.json().data.patient.id;
      const res = await stranger.post('/api/v1/documents/presign', samplePresignBody(patientId));
      expect(res.statusCode).toBe(403);
    });

    // Phase 10 hardening (SECURITY.md row 11 / backend.md's GAP G4): this
    // route had no rate limit at all before this session.
    it('429 RATE_LIMITED on the 31st presign for the same user within an hour', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post('/api/v1/patients', samplePatientPayload());
      const patientId = patientRes.json().data.patient.id;
      for (let i = 0; i < 30; i++) {
        const res = await owner.post(
          '/api/v1/documents/presign',
          samplePresignBody(patientId, { id: randomUUID() }),
        );
        expect(res.statusCode).toBe(200);
      }
      const res = await owner.post(
        '/api/v1/documents/presign',
        samplePresignBody(patientId, { id: randomUUID() }),
      );
      expect(res.statusCode).toBe(429);
    });

    it('presigns an upload and creates a pending_upload document', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post('/api/v1/patients', samplePatientPayload());
      const patientId = patientRes.json().data.patient.id;
      const res = await owner.post('/api/v1/documents/presign', samplePresignBody(patientId));
      expect(res.statusCode).toBe(200);
      const body = res.json().data;
      expect(body.document.status).toBe('pending_upload');
      expect(body.document.downloadUrl).toBeNull();
      expect(body.uploadMethod).toBe('PUT');
      expect(body.uploadHeaders['Content-Type']).toBe('image/jpeg');
      expect(body.expiresInSec).toBe(15 * 60);
      expect(typeof body.uploadUrl).toBe('string');
    });

    it('a provider holding an append grant may presign a document', async () => {
      const owner = await asUser(app, Role.patient);
      const provider = await asUser(app, Role.provider);
      const patientRes = await owner.post('/api/v1/patients', samplePatientPayload());
      const patientId = patientRes.json().data.patient.id;
      await createGrant(patientId, provider.user.id, { scope: GrantScope.append });
      const res = await provider.post('/api/v1/documents/presign', samplePresignBody(patientId));
      expect(res.statusCode).toBe(200);
    });

    it('is idempotent on a repeat id for the same patient (same object key, no duplicate row)', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post('/api/v1/patients', samplePatientPayload());
      const patientId = patientRes.json().data.patient.id;
      const body = samplePresignBody(patientId);
      const first = await owner.post('/api/v1/documents/presign', body);
      const second = await owner.post('/api/v1/documents/presign', body);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(first.json().data.document.id).toBe(second.json().data.document.id);
      const count = await prisma.document.count({ where: { id: body.id } });
      expect(count).toBe(1);
    });

    it('rejects reusing an id already bound to a different patient (403)', async () => {
      const owner = await asUser(app, Role.patient);
      const patient1Res = await owner.post('/api/v1/patients', samplePatientPayload());
      const patient2Res = await owner.post(
        '/api/v1/patients',
        samplePatientPayload({ id: randomUUID(), name: 'Other Patient' }),
      );
      const patient1Id = patient1Res.json().data.patient.id;
      const patient2Id = patient2Res.json().data.patient.id;
      const docId = randomUUID();
      await owner.post('/api/v1/documents/presign', samplePresignBody(patient1Id, { id: docId }));
      const res = await owner.post(
        '/api/v1/documents/presign',
        samplePresignBody(patient2Id, { id: docId }),
      );
      expect(res.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/documents/:id/complete (REQ-DOC-004)', () => {
    it('requires authentication', async () => {
      const client = testClient(app);
      const res = await client.post(`/api/v1/documents/${randomUUID()}/complete`);
      expect(res.statusCode).toBe(401);
    });

    it('429 RATE_LIMITED on the 31st complete call for the same user within an hour', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post('/api/v1/patients', samplePatientPayload());
      const patientId = patientRes.json().data.patient.id;
      const presignRes = await owner.post(
        '/api/v1/documents/presign',
        samplePresignBody(patientId),
      );
      const documentId = presignRes.json().data.document.id;
      // Each call 400s (no live S3 to confirm the upload against), but the
      // rate limit is checked before that HEAD call, so it still counts.
      for (let i = 0; i < 30; i++) {
        const res = await owner.post(`/api/v1/documents/${documentId}/complete`);
        expect(res.statusCode).toBe(400);
      }
      const res = await owner.post(`/api/v1/documents/${documentId}/complete`);
      expect(res.statusCode).toBe(429);
    });

    it('404s for an unknown document id', async () => {
      const owner = await asUser(app, Role.patient);
      const res = await owner.post(`/api/v1/documents/${randomUUID()}/complete`);
      expect(res.statusCode).toBe(404);
    });

    it('rejects a stranger with no append rights (403)', async () => {
      const owner = await asUser(app, Role.patient);
      const stranger = await asUser(app, Role.provider);
      const patientRes = await owner.post('/api/v1/patients', samplePatientPayload());
      const patientId = patientRes.json().data.patient.id;
      const presignRes = await owner.post(
        '/api/v1/documents/presign',
        samplePresignBody(patientId),
      );
      const documentId = presignRes.json().data.document.id;
      const res = await stranger.post(`/api/v1/documents/${documentId}/complete`);
      expect(res.statusCode).toBe(403);
    });

    it('rejects completion when the object cannot be confirmed in storage (real S3 unreachable in this environment)', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post('/api/v1/patients', samplePatientPayload());
      const patientId = patientRes.json().data.patient.id;
      const presignRes = await owner.post(
        '/api/v1/documents/presign',
        samplePresignBody(patientId),
      );
      const documentId = presignRes.json().data.document.id;
      const res = await owner.post(`/api/v1/documents/${documentId}/complete`);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    // Phase 10 hardening (SECURITY.md row 15): a presigned URL's
    // Content-Type header is only ever a client declaration - storage
    // itself never enforces it, so completeDocument re-checks the real
    // uploaded bytes/size directly.
    it('rejects an uploaded object whose real bytes are not a JPEG', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post('/api/v1/patients', samplePatientPayload());
      const patientId = patientRes.json().data.patient.id;
      const presignRes = await owner.post(
        '/api/v1/documents/presign',
        samplePresignBody(patientId),
      );
      const documentId = presignRes.json().data.document.id;
      const actor = { id: owner.user.id, role: owner.user.role, facilityId: owner.user.facilityId };

      const notAJpeg = fakeStorage({
        downloadObject: async () => ({
          buffer: Buffer.from('%PDF-1.4 not actually a jpeg'),
          contentType: 'image/jpeg',
        }),
      });
      await expect(completeDocument(actor, documentId, notAJpeg)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('rejects an uploaded object larger than the declared sizeBytes', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post('/api/v1/patients', samplePatientPayload());
      const patientId = patientRes.json().data.patient.id;
      const presignRes = await owner.post(
        '/api/v1/documents/presign',
        samplePresignBody(patientId, { sizeBytes: 1000 }),
      );
      const documentId = presignRes.json().data.document.id;
      const actor = { id: owner.user.id, role: owner.user.role, facilityId: owner.user.facilityId };

      const oversized = fakeStorage({
        headObject: async () => ({ exists: true, contentLength: 2000 }),
      });
      await expect(completeDocument(actor, documentId, oversized)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('flips status to uploaded, bumps version, and audits document_added (fake storage)', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post('/api/v1/patients', samplePatientPayload());
      const patientId = patientRes.json().data.patient.id;
      const presignRes = await owner.post(
        '/api/v1/documents/presign',
        samplePresignBody(patientId),
      );
      const documentId = presignRes.json().data.document.id;

      const updated = await completeDocument(
        { id: owner.user.id, role: owner.user.role, facilityId: owner.user.facilityId },
        documentId,
        fakeStorage(),
      );
      expect(updated.status).toBe('uploaded');
      expect(updated.version).toBe(2);
      expect(typeof updated.downloadUrl).toBe('string');

      const audit = await prisma.auditEntry.findFirst({
        where: { patientId, action: 'document_added' },
      });
      expect(audit).not.toBeNull();
    });
  });

  describe('GET /api/v1/documents/:id (REQ-DOC-005)', () => {
    it('requires authentication', async () => {
      const client = testClient(app);
      const res = await client.get(`/api/v1/documents/${randomUUID()}`);
      expect(res.statusCode).toBe(401);
    });

    it('404s for an unknown document id', async () => {
      const owner = await asUser(app, Role.patient);
      const res = await owner.get(`/api/v1/documents/${randomUUID()}`);
      expect(res.statusCode).toBe(404);
    });

    it('rejects a stranger with no read access (403)', async () => {
      const owner = await asUser(app, Role.patient);
      const stranger = await asUser(app, Role.provider);
      const patientRes = await owner.post('/api/v1/patients', samplePatientPayload());
      const patientId = patientRes.json().data.patient.id;
      const presignRes = await owner.post(
        '/api/v1/documents/presign',
        samplePresignBody(patientId),
      );
      const documentId = presignRes.json().data.document.id;
      const res = await stranger.get(`/api/v1/documents/${documentId}`);
      expect(res.statusCode).toBe(403);
    });

    it('returns a null downloadUrl while pending_upload', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post('/api/v1/patients', samplePatientPayload());
      const patientId = patientRes.json().data.patient.id;
      const presignRes = await owner.post(
        '/api/v1/documents/presign',
        samplePresignBody(patientId),
      );
      const documentId = presignRes.json().data.document.id;
      const res = await owner.get(`/api/v1/documents/${documentId}`);
      expect(res.statusCode).toBe(200);
      expect(res.json().data.document.downloadUrl).toBeNull();
    });

    it('returns a fresh downloadUrl once uploaded (fake storage)', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post('/api/v1/patients', samplePatientPayload());
      const patientId = patientRes.json().data.patient.id;
      const presignRes = await owner.post(
        '/api/v1/documents/presign',
        samplePresignBody(patientId),
      );
      const documentId = presignRes.json().data.document.id;
      const actor = { id: owner.user.id, role: owner.user.role, facilityId: owner.user.facilityId };
      await completeDocument(actor, documentId, fakeStorage());

      const document = await getDocument(actor, documentId, fakeStorage());
      expect(document.status).toBe('uploaded');
      expect(document.downloadUrl).toMatch(/^https:\/\/fake-s3\.test\/.*\?download=1$/);
    });
  });

  describe('POST /api/v1/documents/:id/summarize (REQ-DOC-006)', () => {
    it('404s for an unknown document id', async () => {
      const owner = await asUser(app, Role.patient);
      const res = await owner.post(`/api/v1/documents/${randomUUID()}/summarize`);
      expect(res.statusCode).toBe(404);
    });

    it('returns 501 NOT_IMPLEMENTED while AI_MODE=off', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post('/api/v1/patients', samplePatientPayload());
      const patientId = patientRes.json().data.patient.id;
      const presignRes = await owner.post(
        '/api/v1/documents/presign',
        samplePresignBody(patientId),
      );
      const documentId = presignRes.json().data.document.id;
      const res = await owner.post(`/api/v1/documents/${documentId}/summarize`);
      expect(res.statusCode).toBe(501);
      expect(res.json().error.code).toBe('NOT_IMPLEMENTED');
    });
  });

  // REQ-DOC-007. `config` is a plain object (never frozen), so these tests
  // flip `AI_MODE` for their own duration and restore it - the alternative
  // (a real AI_MODE=on server instance) would need a real ANTHROPIC_API_KEY
  // just to boot (config.ts's own `.refine()`), which this environment
  // doesn't have. `summarizeDocument` is called directly (bypassing HTTP)
  // with a fake `enqueue`, same seam `storage` already provides - the route
  // itself is a two-line pass-through with nothing else to test.
  describe('summarizeDocument with AI_MODE=on (REQ-DOC-007)', () => {
    const originalAiMode = config.AI_MODE;

    beforeEach(() => {
      config.AI_MODE = 'on';
    });

    afterEach(() => {
      config.AI_MODE = originalAiMode;
    });

    it('flips aiSummaryStatus to queued and enqueues a job', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post('/api/v1/patients', samplePatientPayload());
      const patientId = patientRes.json().data.patient.id;
      const presignRes = await owner.post(
        '/api/v1/documents/presign',
        samplePresignBody(patientId),
      );
      const documentId = presignRes.json().data.document.id;
      const actor = { id: owner.user.id, role: owner.user.role, facilityId: owner.user.facilityId };
      await completeDocument(actor, documentId, fakeStorage());

      const enqueued: string[] = [];
      const updated = await summarizeDocument(actor, documentId, async (id) => {
        enqueued.push(id);
      });
      expect(updated.aiSummaryStatus).toBe('queued');
      expect(enqueued).toEqual([documentId]);

      const row = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
      expect(row.aiSummaryStatus).toBe('queued');
    });

    it('rejects summarizing a document that has not finished uploading', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post('/api/v1/patients', samplePatientPayload());
      const patientId = patientRes.json().data.patient.id;
      const presignRes = await owner.post(
        '/api/v1/documents/presign',
        samplePresignBody(patientId),
      );
      const documentId = presignRes.json().data.document.id;
      const actor = { id: owner.user.id, role: owner.user.role, facilityId: owner.user.facilityId };

      await expect(summarizeDocument(actor, documentId, async () => {})).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('rejects a caller with no read access (403)', async () => {
      const owner = await asUser(app, Role.patient);
      const stranger = await asUser(app, Role.provider);
      const patientRes = await owner.post('/api/v1/patients', samplePatientPayload());
      const patientId = patientRes.json().data.patient.id;
      const presignRes = await owner.post(
        '/api/v1/documents/presign',
        samplePresignBody(patientId),
      );
      const documentId = presignRes.json().data.document.id;
      const ownerActor = {
        id: owner.user.id,
        role: owner.user.role,
        facilityId: owner.user.facilityId,
      };
      await completeDocument(ownerActor, documentId, fakeStorage());

      const strangerActor = {
        id: stranger.user.id,
        role: stranger.user.role,
        facilityId: stranger.user.facilityId,
      };
      await expect(
        summarizeDocument(strangerActor, documentId, async () => {}),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('updateDocumentMetadata (REQ-SYNC-003, reused by sync/service.ts)', () => {
    it('updates type/title/takenAt and bumps version', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post('/api/v1/patients', samplePatientPayload());
      const patientId = patientRes.json().data.patient.id;
      const presignRes = await owner.post(
        '/api/v1/documents/presign',
        samplePresignBody(patientId),
      );
      const doc = presignRes.json().data.document;
      const actor = { id: owner.user.id, role: owner.user.role, facilityId: owner.user.facilityId };

      const updated = await updateDocumentMetadata(actor, doc.id, {
        version: doc.version,
        title: 'Updated title',
        type: 'lab',
      });
      expect(updated.title).toBe('Updated title');
      expect(updated.type).toBe('lab');
      expect(updated.version).toBe(doc.version + 1);
    });

    it('rejects a stale version with VERSION_CONFLICT', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post('/api/v1/patients', samplePatientPayload());
      const patientId = patientRes.json().data.patient.id;
      const presignRes = await owner.post(
        '/api/v1/documents/presign',
        samplePresignBody(patientId),
      );
      const doc = presignRes.json().data.document;
      const actor = { id: owner.user.id, role: owner.user.role, facilityId: owner.user.facilityId };

      await expect(
        updateDocumentMetadata(actor, doc.id, { version: doc.version + 1, title: 'X' }),
      ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    });
  });
});
