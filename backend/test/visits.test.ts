import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GrantScope, Role } from '../generated/prisma/enums.js';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { asUser, testClient } from './helpers/client.js';
import { resetDb, resetRedis } from './helpers/db.js';

// REQ-VISIT-*, REQ-ROLE-001/003/004/005. Real Postgres + Redis throughout
// (CLAUDE.md §10) - no mocked database.

async function seedCodes(): Promise<void> {
  await prisma.codeListItem.createMany({
    data: [
      { kind: 'complaint', code: 'CC_FEVER', labelEn: 'Fever', labelNp: 'ज्वरो' },
      { kind: 'diagnosis', code: 'E11', labelEn: 'Type 2 diabetes', labelNp: 'मधुमेह' },
      {
        kind: 'drug',
        code: 'PARACETAMOL_500',
        labelEn: 'Paracetamol 500 mg',
        labelNp: 'प्यारासिटामोल',
      },
    ],
  });
}

function sampleVisitBody(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    visitAt: '2026-09-18T04:05:00.000Z',
    chiefComplaintCode: 'CC_FEVER',
    vitals: { bpSys: 120, bpDia: 80 },
    diagnosisCodes: ['E11'],
    notes: 'Routine check',
    advice: 'Rest and fluids',
    followUpAt: null,
    referral: null,
    prescriptions: [],
    supersedesId: null,
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

describe('visits module', () => {
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
    await seedCodes();
  });

  async function createPatient(
    owner: Awaited<ReturnType<typeof asUser>>,
    overrides: Record<string, unknown> = {},
  ) {
    const body = {
      id: randomUUID(),
      name: 'Sita Chaudhary',
      sex: 'female',
      dob: '2002-03-15',
      allergies: [],
      chronicConditions: [],
      ...overrides,
    };
    const res = await owner.post('/api/v1/patients', body);
    expect(res.statusCode).toBe(200);
    return res.json().data.patient as { id: string };
  }

  describe('POST /api/v1/patients/:id/visits (REQ-VISIT-001..006/009)', () => {
    it('requires authentication', async () => {
      const client = testClient(app);
      const res = await client.post(`/api/v1/patients/${randomUUID()}/visits`, sampleVisitBody());
      expect(res.statusCode).toBe(401);
    });

    it('404s for a nonexistent patient', async () => {
      const owner = await asUser(app, Role.patient);
      const res = await owner.post(`/api/v1/patients/${randomUUID()}/visits`, sampleVisitBody());
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('lets the patient owner self-report a visit, wrapped as { visit }, providerName "Self-reported"', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const res = await owner.post(`/api/v1/patients/${patient.id}/visits`, sampleVisitBody());
      expect(res.statusCode).toBe(200);
      const visit = res.json().data.visit;
      expect(visit.patientId).toBe(patient.id);
      expect(visit.providerUserId).toBe(owner.user.id);
      expect(visit.providerName).toBe('Self-reported');
      expect(visit.facilityId).toBeNull();
      expect(visit.version).toBe(1);
      expect(visit.diagnosisCodes).toEqual(['E11']);
    });

    it('fills providerName/facility from a provider with an append grant', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const provider = await asUser(app, Role.provider, { name: 'Ramesh Thapa (HA)' });
      await createGrant(patient.id, provider.user.id, { scope: GrantScope.append });

      const res = await provider.post(`/api/v1/patients/${patient.id}/visits`, sampleVisitBody());
      expect(res.statusCode).toBe(200);
      const visit = res.json().data.visit;
      expect(visit.providerUserId).toBe(provider.user.id);
      expect(visit.providerName).toBe('Ramesh Thapa (HA)');
    });

    it('is idempotent: posting the same id twice for the same patient returns the existing row', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const body = sampleVisitBody();
      const first = await owner.post(`/api/v1/patients/${patient.id}/visits`, body);
      const second = await owner.post(`/api/v1/patients/${patient.id}/visits`, body);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json().data.visit.id).toBe(first.json().data.visit.id);
      const count = await prisma.visit.count({ where: { id: body.id } });
      expect(count).toBe(1);
    });

    it('rejects the same visit id used under a different patient', async () => {
      const owner = await asUser(app, Role.patient);
      const patientA = await createPatient(owner);
      const patientB = await createPatient(owner, { id: randomUUID() });
      const body = sampleVisitBody();
      const first = await owner.post(`/api/v1/patients/${patientA.id}/visits`, body);
      expect(first.statusCode).toBe(200);
      const second = await owner.post(`/api/v1/patients/${patientB.id}/visits`, body);
      expect(second.statusCode).toBe(403);
      expect(second.json().error.code).toBe('FORBIDDEN');
    });

    it('blocks fchv even with a valid append grant (REQ-ROLE-005)', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const fchv = await asUser(app, Role.fchv);
      await createGrant(patient.id, fchv.user.id, { scope: GrantScope.append });

      const res = await fchv.post(`/api/v1/patients/${patient.id}/visits`, sampleVisitBody());
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    });

    it('rejects a provider with a read-only grant (append required)', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const provider = await asUser(app, Role.provider);
      await createGrant(patient.id, provider.user.id, { scope: GrantScope.read });

      const res = await provider.post(`/api/v1/patients/${patient.id}/visits`, sampleVisitBody());
      expect(res.statusCode).toBe(403);
    });

    it('rejects a provider with no grant at all', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const provider = await asUser(app, Role.provider);

      const res = await provider.post(`/api/v1/patients/${patient.id}/visits`, sampleVisitBody());
      expect(res.statusCode).toBe(403);
    });

    it('rejects a provider whose grant access window has expired', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const provider = await asUser(app, Role.provider);
      await createGrant(patient.id, provider.user.id, { scope: GrantScope.append, expired: true });

      const res = await provider.post(`/api/v1/patients/${patient.id}/visits`, sampleVisitBody());
      expect(res.statusCode).toBe(403);
    });

    it('rejects a provider whose grant was revoked', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const provider = await asUser(app, Role.provider);
      await createGrant(patient.id, provider.user.id, { scope: GrantScope.append, revoked: true });

      const res = await provider.post(`/api/v1/patients/${patient.id}/visits`, sampleVisitBody());
      expect(res.statusCode).toBe(403);
    });

    it('rejects an unknown chiefComplaintCode with a field-level VALIDATION_ERROR (REQ-VISIT-004)', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const res = await owner.post(
        `/api/v1/patients/${patient.id}/visits`,
        sampleVisitBody({ chiefComplaintCode: 'CC_NOT_REAL' }),
      );
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details).toEqual([
        expect.objectContaining({ field: 'chiefComplaintCode' }),
      ]);
    });

    it('rejects an unknown diagnosis code, naming its array index', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const res = await owner.post(
        `/api/v1/patients/${patient.id}/visits`,
        sampleVisitBody({ diagnosisCodes: ['E11', 'NOT_REAL'] }),
      );
      expect(res.statusCode).toBe(400);
      expect(res.json().error.details).toEqual([
        expect.objectContaining({ field: 'diagnosisCodes[1]' }),
      ]);
    });

    it('rejects an unknown drug code inside a prescription', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const res = await owner.post(
        `/api/v1/patients/${patient.id}/visits`,
        sampleVisitBody({
          prescriptions: [
            {
              id: 'rx_1',
              drugCode: 'NOT_REAL',
              drugName: 'Fake drug',
              dose: '1 tab',
              frequency: 'OD',
              durationDays: 5,
            },
          ],
        }),
      );
      expect(res.statusCode).toBe(400);
      expect(res.json().error.details).toEqual([
        expect.objectContaining({ field: 'prescriptions[0].drugCode' }),
      ]);
    });

    it('rejects notes over 1000 characters', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const res = await owner.post(
        `/api/v1/patients/${patient.id}/visits`,
        sampleVisitBody({ notes: 'x'.repeat(1001) }),
      );
      expect(res.statusCode).toBe(400);
    });

    it('creates a follow_up reminder due 1 day before followUpAt at 09:00 Kathmandu (REQ-VISIT-005)', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const res = await owner.post(
        `/api/v1/patients/${patient.id}/visits`,
        sampleVisitBody({ followUpAt: '2026-10-18' }),
      );
      expect(res.statusCode).toBe(200);
      const visitId = res.json().data.visit.id;

      const reminders = await prisma.reminder.findMany({ where: { patientId: patient.id } });
      expect(reminders).toHaveLength(1);
      const reminder = reminders[0];
      expect(reminder?.refId).toBe(visitId);
      expect(reminder?.kind).toBe('follow_up');
      expect(reminder?.status).toBe('pending');
      expect(reminder?.recipientPhone).toBe(owner.user.phone);
      // 09:00 Kathmandu (UTC+5:45) on 2026-10-17 = 03:15 UTC.
      expect(reminder?.dueAt.toISOString()).toBe('2026-10-17T03:15:00.000Z');
      expect(reminder?.messageEn.length).toBeGreaterThan(0);
      expect(reminder?.messageNp.length).toBeGreaterThan(0);
    });

    it('creates no reminder when followUpAt is not set', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      await owner.post(`/api/v1/patients/${patient.id}/visits`, sampleVisitBody());
      const reminders = await prisma.reminder.findMany({ where: { patientId: patient.id } });
      expect(reminders).toHaveLength(0);
    });

    it('logs a visit_added audit entry', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      await owner.post(`/api/v1/patients/${patient.id}/visits`, sampleVisitBody());
      const entries = await prisma.auditEntry.findMany({
        where: { patientId: patient.id, action: 'visit_added' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.actorUserId).toBe(owner.user.id);
    });
  });

  describe('GET /api/v1/patients/:id/visits (REQ-VISIT-007)', () => {
    it('requires authentication', async () => {
      const client = testClient(app);
      const res = await client.get(`/api/v1/patients/${randomUUID()}/visits`);
      expect(res.statusCode).toBe(401);
    });

    it('404s for a nonexistent patient', async () => {
      const owner = await asUser(app, Role.patient);
      const res = await owner.get(`/api/v1/patients/${randomUUID()}/visits`);
      expect(res.statusCode).toBe(404);
    });

    it('403s for a user with no access to the patient', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const stranger = await asUser(app, Role.provider);
      const res = await stranger.get(`/api/v1/patients/${patient.id}/visits`);
      expect(res.statusCode).toBe(403);
    });

    it("lists the owner's own visits newest first", async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const older = sampleVisitBody({ visitAt: '2026-01-01T00:00:00.000Z' });
      const newer = sampleVisitBody({ visitAt: '2026-06-01T00:00:00.000Z' });
      await owner.post(`/api/v1/patients/${patient.id}/visits`, older);
      await owner.post(`/api/v1/patients/${patient.id}/visits`, newer);

      const res = await owner.get(`/api/v1/patients/${patient.id}/visits`);
      expect(res.statusCode).toBe(200);
      const items = res.json().data.items;
      expect(items).toHaveLength(2);
      expect(items[0].id).toBe(newer.id);
      expect(items[1].id).toBe(older.id);
    });

    it('respects a provider with an active read-scope grant', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      await owner.post(`/api/v1/patients/${patient.id}/visits`, sampleVisitBody());
      const provider = await asUser(app, Role.provider);
      await createGrant(patient.id, provider.user.id, { scope: GrantScope.read });

      const res = await provider.get(`/api/v1/patients/${patient.id}/visits`);
      expect(res.statusCode).toBe(200);
      expect(res.json().data.items).toHaveLength(1);
    });

    it('caps the returned items at the requested limit', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      await owner.post(`/api/v1/patients/${patient.id}/visits`, sampleVisitBody());
      await owner.post(`/api/v1/patients/${patient.id}/visits`, sampleVisitBody());

      const res = await owner.get(`/api/v1/patients/${patient.id}/visits?limit=1`);
      expect(res.statusCode).toBe(200);
      expect(res.json().data.items).toHaveLength(1);
    });
  });
});
