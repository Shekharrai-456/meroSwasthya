import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GrantScope, Role } from '../generated/prisma/enums.js';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { asUser, testClient } from './helpers/client.js';
import { resetDb, resetRedis } from './helpers/db.js';

// REQ-SYNC-001..011, REQ-TEST-002. Real Postgres + Redis throughout
// (CLAUDE.md §10). `documents` is deliberately absent from every test here -
// Documents (Phase 9) doesn't exist yet, see src/modules/sync/schemas.ts.

function samplePatientPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Sita Chaudhary',
    sex: 'female',
    dob: '2002-03-15',
    allergies: [],
    chronicConditions: [],
    ...overrides,
  };
}

describe('sync module', () => {
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
    await prisma.codeListItem.createMany({
      data: [{ kind: 'complaint', code: 'CC_FEVER', labelEn: 'Fever', labelNp: 'ज्वरो' }],
    });
  });

  describe('POST /api/v1/sync/push (REQ-SYNC-001..008)', () => {
    it('requires authentication', async () => {
      const client = testClient(app);
      const res = await client.post('/api/v1/sync/push', { deviceId: 'dev1', changes: [] });
      expect(res.statusCode).toBe(401);
    });

    it('A.6 case 13: creates a patient via push (baseVersion 0), then the same opId replays as duplicate with the same row', async () => {
      const owner = await asUser(app, Role.patient);
      const patientId = randomUUID();
      const opId = randomUUID();
      const change = {
        opId,
        table: 'patients',
        op: 'upsert',
        rowId: patientId,
        baseVersion: 0,
        payload: samplePatientPayload(),
      };

      const first = await owner.post('/api/v1/sync/push', { deviceId: 'dev1', changes: [change] });
      expect(first.statusCode).toBe(200);
      const firstResult = first.json().data.results[0];
      expect(firstResult.status).toBe('applied');
      expect(firstResult.row.id).toBe(patientId);
      expect(firstResult.row.version).toBe(1);

      const second = await owner.post('/api/v1/sync/push', { deviceId: 'dev1', changes: [change] });
      const secondResult = second.json().data.results[0];
      expect(secondResult.status).toBe('duplicate');
      expect(secondResult.row.id).toBe(patientId);

      const count = await prisma.patient.count({ where: { id: patientId } });
      expect(count).toBe(1);
    });

    it('applies a patient update when baseVersion matches current', async () => {
      const owner = await asUser(app, Role.patient);
      const patientId = randomUUID();
      await owner.post('/api/v1/sync/push', {
        deviceId: 'dev1',
        changes: [
          {
            opId: randomUUID(),
            table: 'patients',
            op: 'upsert',
            rowId: patientId,
            baseVersion: 0,
            payload: samplePatientPayload(),
          },
        ],
      });

      const res = await owner.post('/api/v1/sync/push', {
        deviceId: 'dev1',
        changes: [
          {
            opId: randomUUID(),
            table: 'patients',
            op: 'upsert',
            rowId: patientId,
            baseVersion: 1,
            payload: { allergies: ['penicillin'] },
          },
        ],
      });
      const result = res.json().data.results[0];
      expect(result.status).toBe('applied');
      expect(result.row.version).toBe(2);
      expect(result.row.allergies).toEqual(['penicillin']);
    });

    it('A.6 case 14: a stale baseVersion on an existing row returns conflict with the current row', async () => {
      const owner = await asUser(app, Role.patient);
      const patientId = randomUUID();
      await owner.post('/api/v1/sync/push', {
        deviceId: 'dev1',
        changes: [
          {
            opId: randomUUID(),
            table: 'patients',
            op: 'upsert',
            rowId: patientId,
            baseVersion: 0,
            payload: samplePatientPayload(),
          },
        ],
      });

      const res = await owner.post('/api/v1/sync/push', {
        deviceId: 'dev1',
        changes: [
          {
            opId: randomUUID(),
            table: 'patients',
            op: 'upsert',
            rowId: patientId,
            baseVersion: 0,
            payload: { allergies: ['penicillin'] },
          },
        ],
      });
      const result = res.json().data.results[0];
      expect(result.status).toBe('conflict');
      expect(result.current.version).toBe(1);
    });

    it('never fails the whole batch: one rejected change alongside one applied change', async () => {
      const owner = await asUser(app, Role.patient);
      const goodId = randomUUID();
      const res = await owner.post('/api/v1/sync/push', {
        deviceId: 'dev1',
        changes: [
          {
            opId: randomUUID(),
            table: 'patients',
            op: 'upsert',
            rowId: goodId,
            baseVersion: 0,
            payload: samplePatientPayload(),
          },
          {
            opId: randomUUID(),
            table: 'patients',
            op: 'upsert',
            rowId: randomUUID(),
            baseVersion: 0,
            payload: { name: '', sex: 'not-a-sex', dob: 'not-a-date' },
          },
        ],
      });
      expect(res.statusCode).toBe(200);
      const [ok, bad] = res.json().data.results;
      expect(ok.status).toBe('applied');
      expect(bad.status).toBe('rejected');
      expect(bad.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a visits change from fchv even with a valid append grant (REQ-ROLE-005/SYNC-003)', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post(
        '/api/v1/patients',
        samplePatientPayload({ id: randomUUID() }),
      );
      const patientId = patientRes.json().data.patient.id;
      const fchv = await asUser(app, Role.fchv);
      await prisma.accessGrant.create({
        data: {
          patientId,
          scope: GrantScope.append,
          tokenJti: randomUUID(),
          expiresAt: new Date(Date.now() + 600_000),
          redeemedByUserId: fchv.user.id,
          redeemedAt: new Date(),
          accessUntil: new Date(Date.now() + 86_400_000),
        },
      });

      const res = await fchv.post('/api/v1/sync/push', {
        deviceId: 'dev1',
        changes: [
          {
            opId: randomUUID(),
            table: 'visits',
            op: 'upsert',
            rowId: randomUUID(),
            baseVersion: 0,
            payload: {
              patientId,
              visitAt: new Date().toISOString(),
              chiefComplaintCode: 'CC_FEVER',
              vitals: {},
              diagnosisCodes: [],
              prescriptions: [],
            },
          },
        ],
      });
      const result = res.json().data.results[0];
      expect(result.status).toBe('rejected');
      expect(result.error.code).toBe('FORBIDDEN');
    });

    it('rejects a change for an unrecognised table at the schema layer (documents not yet built)', async () => {
      const owner = await asUser(app, Role.patient);
      const res = await owner.post('/api/v1/sync/push', {
        deviceId: 'dev1',
        changes: [
          {
            opId: randomUUID(),
            table: 'documents',
            op: 'upsert',
            rowId: randomUUID(),
            baseVersion: 0,
            payload: {},
          },
        ],
      });
      expect(res.statusCode).toBe(400);
    });

    it('REQ-REMIND-009: reminders are not a syncable table - the client can never write one via push', async () => {
      const owner = await asUser(app, Role.patient);
      const res = await owner.post('/api/v1/sync/push', {
        deviceId: 'dev1',
        changes: [
          {
            opId: randomUUID(),
            table: 'reminders',
            op: 'upsert',
            rowId: randomUUID(),
            baseVersion: 0,
            payload: {},
          },
        ],
      });
      expect(res.statusCode).toBe(400);
    });

    it('creates a visit via push (append-only reuse of createVisit), idempotent on a repeat rowId with a fresh opId', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post(
        '/api/v1/patients',
        samplePatientPayload({ id: randomUUID() }),
      );
      const patientId = patientRes.json().data.patient.id;
      const visitId = randomUUID();
      const visitPayload = {
        patientId,
        visitAt: new Date().toISOString(),
        chiefComplaintCode: 'CC_FEVER',
        vitals: {},
        diagnosisCodes: [],
        prescriptions: [],
      };

      const first = await owner.post('/api/v1/sync/push', {
        deviceId: 'dev1',
        changes: [
          {
            opId: randomUUID(),
            table: 'visits',
            op: 'upsert',
            rowId: visitId,
            baseVersion: 0,
            payload: visitPayload,
          },
        ],
      });
      expect(first.json().data.results[0].status).toBe('applied');

      // Same rowId, a *different* opId (simulates the client re-deriving the
      // outbox row rather than opId-level dedup) - createVisit's own
      // idempotent-return-existing behavior must still apply.
      const second = await owner.post('/api/v1/sync/push', {
        deviceId: 'dev1',
        changes: [
          {
            opId: randomUUID(),
            table: 'visits',
            op: 'upsert',
            rowId: visitId,
            baseVersion: 0,
            payload: visitPayload,
          },
        ],
      });
      expect(second.json().data.results[0].status).toBe('applied');
      const count = await prisma.visit.count({ where: { id: visitId } });
      expect(count).toBe(1);
    });

    it('records a delivery via push, closing the pregnancy (append-only reuse of recordDelivery)', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post(
        '/api/v1/patients',
        samplePatientPayload({ id: randomUUID() }),
      );
      const patientId = patientRes.json().data.patient.id;
      const pregRes = await owner.post(`/api/v1/patients/${patientId}/pregnancies`, {
        id: randomUUID(),
        lmp: '2026-02-20',
        gravida: 1,
        para: 0,
        riskFactors: [],
      });
      const pregnancyId = pregRes.json().data.pregnancy.id;

      const res = await owner.post('/api/v1/sync/push', {
        deviceId: 'dev1',
        changes: [
          {
            opId: randomUUID(),
            table: 'deliveries',
            op: 'upsert',
            rowId: randomUUID(),
            baseVersion: 0,
            payload: {
              pregnancyId,
              deliveredAt: new Date().toISOString(),
              place: 'hospital',
              mode: 'normal',
              outcome: 'live_birth',
              complications: [],
            },
          },
        ],
      });
      expect(res.json().data.results[0].status).toBe('applied');
      const pregnancy = await prisma.pregnancy.findUniqueOrThrow({ where: { id: pregnancyId } });
      expect(pregnancy.status).toBe('delivered');
    });

    it('rejects an anc_contact create when its pregnancy does not exist', async () => {
      const owner = await asUser(app, Role.patient);
      const res = await owner.post('/api/v1/sync/push', {
        deviceId: 'dev1',
        changes: [
          {
            opId: randomUUID(),
            table: 'anc_contacts',
            op: 'upsert',
            rowId: randomUUID(),
            baseVersion: 0,
            payload: {
              pregnancyId: randomUUID(),
              contactNo: 1,
              weekTarget: 12,
              dueAt: '2026-05-15',
            },
          },
        ],
      });
      const result = res.json().data.results[0];
      expect(result.status).toBe('rejected');
      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('creates a pregnancy with its 8 contacts via push, running the same logic as POST (REQ-SYNC-007)', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post(
        '/api/v1/patients',
        samplePatientPayload({ id: randomUUID() }),
      );
      const patientId = patientRes.json().data.patient.id;
      const pregnancyId = randomUUID();

      const res = await owner.post('/api/v1/sync/push', {
        deviceId: 'dev1',
        changes: [
          {
            opId: randomUUID(),
            table: 'pregnancies',
            op: 'upsert',
            rowId: pregnancyId,
            baseVersion: 0,
            payload: { patientId, lmp: '2026-02-20', gravida: 1, para: 0, riskFactors: [] },
          },
        ],
      });
      expect(res.json().data.results[0].status).toBe('applied');
      const contacts = await prisma.ancContact.count({ where: { pregnancyId } });
      expect(contacts).toBe(8);
    });

    it('A.6 case 3/red triage: recomputes triage server-side on an anc_contact update and cancels its anc_missed reminder (REQ-SYNC-006)', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post(
        '/api/v1/patients',
        samplePatientPayload({ id: randomUUID() }),
      );
      const patientId = patientRes.json().data.patient.id;
      const pregRes = await owner.post(`/api/v1/patients/${patientId}/pregnancies`, {
        id: randomUUID(),
        lmp: '2026-02-20',
        gravida: 1,
        para: 0,
        riskFactors: [],
      });
      const { pregnancy, ancContacts } = pregRes.json().data;
      const contact4 = ancContacts.find((c: { contactNo: number }) => c.contactNo === 4);

      const res = await owner.post('/api/v1/sync/push', {
        deviceId: 'dev1',
        changes: [
          {
            opId: randomUUID(),
            table: 'anc_contacts',
            op: 'upsert',
            rowId: contact4.id,
            baseVersion: 1,
            payload: {
              pregnancyId: pregnancy.id,
              contactNo: 4,
              doneAt: new Date().toISOString(),
              findings: { bpSys: 150, bpDia: 95 },
              dangerSigns: ['SEVERE_HEADACHE_BLURRED_VISION'],
              referral: null,
            },
          },
        ],
      });
      const result = res.json().data.results[0];
      expect(result.status).toBe('applied');
      expect(result.row.triageLevel).toBe('red');

      const missed = await prisma.reminder.findMany({
        where: { refId: contact4.id, kind: 'anc_missed' },
      });
      expect(missed.every((r) => r.status === 'cancelled')).toBe(true);
    });

    it('A.6 case 14 (anc_contacts variant): stale baseVersion on an anc_contact returns conflict', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post(
        '/api/v1/patients',
        samplePatientPayload({ id: randomUUID() }),
      );
      const patientId = patientRes.json().data.patient.id;
      const pregRes = await owner.post(`/api/v1/patients/${patientId}/pregnancies`, {
        id: randomUUID(),
        lmp: '2026-02-20',
        gravida: 1,
        para: 0,
        riskFactors: [],
      });
      const { pregnancy, ancContacts } = pregRes.json().data;
      const contact1 = ancContacts.find((c: { contactNo: number }) => c.contactNo === 1);

      const res = await owner.post('/api/v1/sync/push', {
        deviceId: 'dev1',
        changes: [
          {
            opId: randomUUID(),
            table: 'anc_contacts',
            op: 'upsert',
            rowId: contact1.id,
            baseVersion: 2, // server has version 1
            payload: {
              pregnancyId: pregnancy.id,
              contactNo: 1,
              doneAt: new Date().toISOString(),
              findings: null,
              dangerSigns: [],
              referral: null,
            },
          },
        ],
      });
      const result = res.json().data.results[0];
      expect(result.status).toBe('conflict');
      expect(result.current.version).toBe(1);
    });
  });

  describe('GET /api/v1/sync/pull (REQ-SYNC-009..011)', () => {
    it('requires authentication', async () => {
      const client = testClient(app);
      const res = await client.get('/api/v1/sync/pull?deviceId=dev1');
      expect(res.statusCode).toBe(401);
    });

    it('returns only rows for patients the caller may see, ordered updatedAt asc, with a progressing cursor', async () => {
      const owner = await asUser(app, Role.patient);
      const stranger = await asUser(app, Role.patient);
      const myPatientRes = await owner.post(
        '/api/v1/patients',
        samplePatientPayload({ id: randomUUID() }),
      );
      await stranger.post(
        '/api/v1/patients',
        samplePatientPayload({ id: randomUUID(), name: 'Not Mine' }),
      );

      const res = await owner.get('/api/v1/sync/pull?deviceId=dev1');
      expect(res.statusCode).toBe(200);
      const body = res.json().data;
      const patientRows = body.changes.filter((c: { table: string }) => c.table === 'patients');
      expect(patientRows).toHaveLength(1);
      expect(patientRows[0].row.id).toBe(myPatientRes.json().data.patient.id);
      expect(body.hasMore).toBe(false);
      expect(typeof body.cursor).toBe('string');
    });

    it('returns an empty page with no accessible patients at all', async () => {
      const lonely = await asUser(app, Role.patient);
      const res = await lonely.get('/api/v1/sync/pull?deviceId=dev1');
      expect(res.statusCode).toBe(200);
      expect(res.json().data.changes).toHaveLength(0);
      expect(res.json().data.hasMore).toBe(false);
    });

    it('merges visits, pregnancies, anc_contacts, and deliveries alongside patients', async () => {
      const owner = await asUser(app, Role.patient);
      const patientRes = await owner.post(
        '/api/v1/patients',
        samplePatientPayload({ id: randomUUID() }),
      );
      const patientId = patientRes.json().data.patient.id;
      await prisma.codeListItem.createMany({
        data: [{ kind: 'complaint', code: 'CC_FEVER', labelEn: 'Fever', labelNp: 'ज्वरो' }],
        skipDuplicates: true,
      });
      await owner.post(`/api/v1/patients/${patientId}/visits`, {
        id: randomUUID(),
        visitAt: new Date().toISOString(),
        chiefComplaintCode: 'CC_FEVER',
        vitals: {},
        diagnosisCodes: [],
        prescriptions: [],
      });
      const pregRes = await owner.post(`/api/v1/patients/${patientId}/pregnancies`, {
        id: randomUUID(),
        lmp: '2026-02-20',
        gravida: 1,
        para: 0,
        riskFactors: [],
      });
      const pregnancyId = pregRes.json().data.pregnancy.id;
      const contact1 = pregRes
        .json()
        .data.ancContacts.find((c: { contactNo: number }) => c.contactNo === 1);
      await owner.put(`/api/v1/pregnancies/${pregnancyId}/contacts/1`, {
        doneAt: new Date().toISOString(),
        findings: null,
        dangerSigns: [],
        referral: null,
      });
      await owner.post(`/api/v1/pregnancies/${pregnancyId}/delivery`, {
        id: randomUUID(),
        deliveredAt: new Date().toISOString(),
        place: 'hospital',
        mode: 'normal',
        outcome: 'live_birth',
        complications: [],
      });

      const res = await owner.get('/api/v1/sync/pull?deviceId=dev1');
      const tables = new Set(res.json().data.changes.map((c: { table: string }) => c.table));
      expect(tables).toEqual(
        new Set(['patients', 'visits', 'pregnancies', 'anc_contacts', 'deliveries']),
      );
      const contactRow = res
        .json()
        .data.changes.find(
          (c: { table: string; row: { id: string } }) =>
            c.table === 'anc_contacts' && c.row.id === contact1.id,
        );
      expect(contactRow.row.doneAt).not.toBeNull();
    });

    it('a subsequent pull with since=cursor returns nothing new', async () => {
      const owner = await asUser(app, Role.patient);
      await owner.post('/api/v1/patients', samplePatientPayload({ id: randomUUID() }));

      const first = await owner.get('/api/v1/sync/pull?deviceId=dev1');
      const cursor = first.json().data.cursor;

      const second = await owner.get(
        `/api/v1/sync/pull?deviceId=dev1&since=${encodeURIComponent(cursor)}`,
      );
      expect(second.json().data.changes).toHaveLength(0);
    });

    it('includes patients visible only via an active redeemed grant', async () => {
      const owner = await asUser(app, Role.patient);
      const provider = await asUser(app, Role.provider);
      const patientRes = await owner.post(
        '/api/v1/patients',
        samplePatientPayload({ id: randomUUID() }),
      );
      const patientId = patientRes.json().data.patient.id;
      await prisma.accessGrant.create({
        data: {
          patientId,
          scope: GrantScope.read,
          tokenJti: randomUUID(),
          expiresAt: new Date(Date.now() + 600_000),
          redeemedByUserId: provider.user.id,
          redeemedAt: new Date(),
          accessUntil: new Date(Date.now() + 86_400_000),
        },
      });

      const res = await provider.get('/api/v1/sync/pull?deviceId=dev1');
      const patientRows = res
        .json()
        .data.changes.filter((c: { table: string }) => c.table === 'patients');
      expect(patientRows.some((r: { row: { id: string } }) => r.row.id === patientId)).toBe(true);
    });
  });
});
