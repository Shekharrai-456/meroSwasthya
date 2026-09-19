import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '../generated/prisma/enums.js';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { asUser, testClient } from './helpers/client.js';
import { resetDb, resetRedis } from './helpers/db.js';

// REQ-PREG-*, REQ-RULES-*. Real Postgres + Redis throughout (CLAUDE.md §10).
// A.6 case 12 (male patient -> 422) lives here, not test/rules.test.ts, since
// it's an endpoint-level check, not pure rules-engine logic.

describe('maternal module', () => {
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

  function samplePregnancyBody(overrides: Record<string, unknown> = {}) {
    return {
      id: randomUUID(),
      lmp: '2026-02-20',
      edd: null,
      gravida: 1,
      para: 0,
      riskFactors: [],
      birthPlan: null,
      ...overrides,
    };
  }

  describe('POST /api/v1/patients/:id/pregnancies (REQ-PREG-001..007)', () => {
    it('requires authentication', async () => {
      const client = testClient(app);
      const res = await client.post(
        `/api/v1/patients/${randomUUID()}/pregnancies`,
        samplePregnancyBody(),
      );
      expect(res.statusCode).toBe(401);
    });

    it('404s for a nonexistent patient', async () => {
      const owner = await asUser(app, Role.patient);
      const res = await owner.post(
        `/api/v1/patients/${randomUUID()}/pregnancies`,
        samplePregnancyBody(),
      );
      expect(res.statusCode).toBe(404);
    });

    it('403s for a user with no access to the patient', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const stranger = await asUser(app, Role.provider);
      const res = await stranger.post(
        `/api/v1/patients/${patient.id}/pregnancies`,
        samplePregnancyBody(),
      );
      expect(res.statusCode).toBe(403);
    });

    it('A.6 case 12: 422 RULE_VIOLATION for a male patient', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner, { sex: 'male' });
      const res = await owner.post(
        `/api/v1/patients/${patient.id}/pregnancies`,
        samplePregnancyBody(),
      );
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('RULE_VIOLATION');
    });

    it('422s on a second active pregnancy for the same patient', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const first = await owner.post(
        `/api/v1/patients/${patient.id}/pregnancies`,
        samplePregnancyBody(),
      );
      expect(first.statusCode).toBe(200);
      const second = await owner.post(
        `/api/v1/patients/${patient.id}/pregnancies`,
        samplePregnancyBody({ id: randomUUID() }),
      );
      expect(second.statusCode).toBe(422);
      expect(second.json().error.code).toBe('RULE_VIOLATION');
    });

    it('creates the pregnancy, 8 AncContacts with correct EDD/schedule (A.6 case 1), riskLevel normal', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const res = await owner.post(
        `/api/v1/patients/${patient.id}/pregnancies`,
        samplePregnancyBody({ lmp: '2026-02-20', edd: null }),
      );
      expect(res.statusCode).toBe(200);
      const { pregnancy, ancContacts } = res.json().data;
      expect(pregnancy.edd).toBe('2026-11-27');
      expect(pregnancy.riskLevel).toBe('normal');
      expect(ancContacts).toHaveLength(8);
      const contact1 = ancContacts.find((c: { contactNo: number }) => c.contactNo === 1);
      const contact5 = ancContacts.find((c: { contactNo: number }) => c.contactNo === 5);
      expect(contact1.dueAt).toBe('2026-05-15');
      expect(contact1.doneAt).toBeNull();
      expect(contact5.dueAt).toBe('2026-10-16');
    });

    it('computes edd from lmp when edd is omitted, and vice versa', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const res = await owner.post(
        `/api/v1/patients/${patient.id}/pregnancies`,
        samplePregnancyBody({ lmp: null, edd: '2026-11-27' }),
      );
      expect(res.statusCode).toBe(200);
      expect(res.json().data.pregnancy.edd).toBe('2026-11-27');
      expect(res.json().data.pregnancy.lmp).toBeNull();
    });

    it('rejects a body with neither lmp nor edd', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const res = await owner.post(
        `/api/v1/patients/${patient.id}/pregnancies`,
        samplePregnancyBody({ lmp: null, edd: null }),
      );
      expect(res.statusCode).toBe(400);
    });

    it('sets riskLevel high when riskFactors are present', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const res = await owner.post(
        `/api/v1/patients/${patient.id}/pregnancies`,
        samplePregnancyBody({ riskFactors: ['PREV_CS'] }),
      );
      expect(res.json().data.pregnancy.riskLevel).toBe('high');
    });

    it('creates anc_due reminders for future contacts (to owner + emergency contact) and anc_missed for every contact', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner, { emergencyContactPhone: '+9779801000099' });
      // lmp far enough in the past that contact 1 (week 12) is already overdue,
      // but later contacts are still in the future - exercises both branches.
      const lmp = new Date();
      lmp.setUTCDate(lmp.getUTCDate() - 100);
      const lmpStr = lmp.toISOString().slice(0, 10);

      const res = await owner.post(
        `/api/v1/patients/${patient.id}/pregnancies`,
        samplePregnancyBody({ lmp: lmpStr, edd: null }),
      );
      expect(res.statusCode).toBe(200);
      const pregnancyId = res.json().data.pregnancy.id;

      const reminders = await prisma.reminder.findMany({ where: { pregnancyId } });
      // 8 anc_missed (always) + anc_due pairs (owner + emergency contact) for
      // whichever contacts are still in the future.
      const ancMissed = reminders.filter((r) => r.kind === 'anc_missed');
      const ancDue = reminders.filter((r) => r.kind === 'anc_due');
      expect(ancMissed).toHaveLength(8);
      expect(ancDue.length).toBeGreaterThan(0);
      expect(ancDue.length % 2).toBe(0); // owner + emergency contact, always paired
      expect(ancDue.some((r) => r.recipientPhone === owner.user.phone)).toBe(true);
      expect(ancDue.some((r) => r.recipientPhone === '+9779801000099')).toBe(true);
    });
  });

  describe('GET /api/v1/pregnancies/:id (REQ-PREG-008)', () => {
    it('requires authentication', async () => {
      const client = testClient(app);
      const res = await client.get(`/api/v1/pregnancies/${randomUUID()}`);
      expect(res.statusCode).toBe(401);
    });

    it('404s for a nonexistent pregnancy', async () => {
      const owner = await asUser(app, Role.patient);
      const res = await owner.get(`/api/v1/pregnancies/${randomUUID()}`);
      expect(res.statusCode).toBe(404);
    });

    it('403s for a user with no access to the underlying patient', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const created = await owner.post(
        `/api/v1/patients/${patient.id}/pregnancies`,
        samplePregnancyBody(),
      );
      const pregnancyId = created.json().data.pregnancy.id;
      const stranger = await asUser(app, Role.provider);
      const res = await stranger.get(`/api/v1/pregnancies/${pregnancyId}`);
      expect(res.statusCode).toBe(403);
    });

    it('returns the pregnancy with 8 contacts, delivery null, reminders', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const created = await owner.post(
        `/api/v1/patients/${patient.id}/pregnancies`,
        samplePregnancyBody(),
      );
      const pregnancyId = created.json().data.pregnancy.id;
      const res = await owner.get(`/api/v1/pregnancies/${pregnancyId}`);
      expect(res.statusCode).toBe(200);
      const body = res.json().data;
      expect(body.ancContacts).toHaveLength(8);
      expect(body.delivery).toBeNull();
      expect(Array.isArray(body.reminders)).toBe(true);
      expect(body.pregnancy.nextContact.contactNo).toBe(1);
    });
  });

  describe('PATCH /api/v1/pregnancies/:id (REQ-PREG-009)', () => {
    async function registerPregnancy(owner: Awaited<ReturnType<typeof asUser>>, patientId: string) {
      const res = await owner.post(
        `/api/v1/patients/${patientId}/pregnancies`,
        samplePregnancyBody(),
      );
      return res.json().data.pregnancy as { id: string; version: number };
    }

    it('409s on a stale version', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const pregnancy = await registerPregnancy(owner, patient.id);
      const res = await owner.patch(`/api/v1/pregnancies/${pregnancy.id}`, {
        version: pregnancy.version + 1,
        riskFactors: ['PREV_CS'],
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('VERSION_CONFLICT');
    });

    it('updates birthPlan and increments version', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const pregnancy = await registerPregnancy(owner, patient.id);
      const res = await owner.patch(`/api/v1/pregnancies/${pregnancy.id}`, {
        version: pregnancy.version,
        birthPlan: { facilityName: 'Rapti Provincial Hospital', moneySaved: true },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.pregnancy.version).toBe(pregnancy.version + 1);
      expect(res.json().data.pregnancy.birthPlan.facilityName).toBe('Rapti Provincial Hospital');
    });

    it('recomputes riskLevel when riskFactors changes', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const pregnancy = await registerPregnancy(owner, patient.id);
      const res = await owner.patch(`/api/v1/pregnancies/${pregnancy.id}`, {
        version: pregnancy.version,
        riskFactors: ['AGE_LT_18'],
      });
      expect(res.json().data.pregnancy.riskLevel).toBe('high');
    });

    it('status=ended cancels all pending reminders for the pregnancy', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const pregnancy = await registerPregnancy(owner, patient.id);
      const res = await owner.patch(`/api/v1/pregnancies/${pregnancy.id}`, {
        version: pregnancy.version,
        status: 'ended',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.pregnancy.status).toBe('ended');
      const pending = await prisma.reminder.count({
        where: { pregnancyId: pregnancy.id, status: 'pending' },
      });
      expect(pending).toBe(0);
    });
  });

  describe('PUT /api/v1/pregnancies/:id/contacts/:contactNo (REQ-PREG-010..014)', () => {
    async function registerAndGetContacts(
      owner: Awaited<ReturnType<typeof asUser>>,
      patientId: string,
    ) {
      const res = await owner.post(
        `/api/v1/patients/${patientId}/pregnancies`,
        samplePregnancyBody(),
      );
      return res.json().data as {
        pregnancy: { id: string };
        ancContacts: { id: string; contactNo: number }[];
      };
    }

    it('computes red triage server-side for BP 150/95 + severe headache (A.6 case 3), cancels the anc_missed reminder, logs contact_recorded', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const { pregnancy } = await registerAndGetContacts(owner, patient.id);

      const res = await owner.put(`/api/v1/pregnancies/${pregnancy.id}/contacts/4`, {
        doneAt: new Date().toISOString(),
        findings: { bpSys: 150, bpDia: 95 },
        dangerSigns: ['SEVERE_HEADACHE_BLURRED_VISION'],
        referral: null,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json().data;
      expect(body.ancContact.triageLevel).toBe('red');
      expect(body.ancContact.contactNo).toBe(4);
      expect(body.ancContact.version).toBe(2);

      const missedForContact = await prisma.reminder.findMany({
        where: { refId: body.ancContact.id, kind: 'anc_missed' },
      });
      expect(missedForContact.every((r) => r.status === 'cancelled')).toBe(true);

      const audit = await prisma.auditEntry.findMany({
        where: { patientId: patient.id, action: 'contact_recorded' },
      });
      expect(audit).toHaveLength(1);
    });

    it('rejects a contactNo outside 1..8', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const { pregnancy } = await registerAndGetContacts(owner, patient.id);
      const res = await owner.put(`/api/v1/pregnancies/${pregnancy.id}/contacts/9`, {
        doneAt: new Date().toISOString(),
        findings: null,
        dangerSigns: [],
        referral: null,
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns null nearestReferral when the actor has no facility', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const { pregnancy } = await registerAndGetContacts(owner, patient.id);
      const res = await owner.put(`/api/v1/pregnancies/${pregnancy.id}/contacts/1`, {
        doneAt: new Date().toISOString(),
        findings: null,
        dangerSigns: [],
        referral: null,
      });
      expect(res.json().data.nearestReferral).toBeNull();
    });

    it('returns the nearest birthing facility to the acting provider', async () => {
      await prisma.facility.createMany({
        data: [
          {
            id: 'f_provider',
            name: 'Ghorahi Health Post',
            type: 'health_post',
            hasBirthingCentre: false,
            lat: 28.03,
            lng: 82.48,
            municipality: 'Ghorahi',
          },
          {
            id: 'f_near',
            name: 'Ward 5 Birthing Centre',
            type: 'birthing_centre',
            hasBirthingCentre: true,
            lat: 28.04,
            lng: 82.49,
            municipality: 'Ghorahi',
          },
          {
            id: 'f_far',
            name: 'Rapti Provincial Hospital',
            type: 'hospital',
            hasBirthingCentre: true,
            lat: 29.5,
            lng: 84.0,
            municipality: 'Tulsipur',
          },
        ],
      });
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const provider = await asUser(app, Role.provider, { facilityId: 'f_provider' });
      await prisma.accessGrant.create({
        data: {
          patientId: patient.id,
          scope: 'append',
          tokenJti: randomUUID(),
          expiresAt: new Date(Date.now() + 600_000),
          redeemedByUserId: provider.user.id,
          redeemedAt: new Date(),
          accessUntil: new Date(Date.now() + 86_400_000),
        },
      });
      const { pregnancy } = await registerAndGetContacts(owner, patient.id);

      const res = await provider.put(`/api/v1/pregnancies/${pregnancy.id}/contacts/1`, {
        doneAt: new Date().toISOString(),
        findings: null,
        dangerSigns: [],
        referral: null,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.nearestReferral.id).toBe('f_near');
    });
  });

  describe('POST /api/v1/pregnancies/:id/delivery (REQ-PREG-015)', () => {
    async function registerPregnancy(owner: Awaited<ReturnType<typeof asUser>>, patientId: string) {
      const res = await owner.post(
        `/api/v1/patients/${patientId}/pregnancies`,
        samplePregnancyBody(),
      );
      return res.json().data.pregnancy as { id: string };
    }

    function sampleDeliveryBody(overrides: Record<string, unknown> = {}) {
      return {
        id: randomUUID(),
        deliveredAt: new Date().toISOString(),
        place: 'hospital',
        mode: 'normal',
        outcome: 'live_birth',
        babyWeightKg: 2.9,
        babySex: 'female',
        complications: [],
        ...overrides,
      };
    }

    it('closes the pregnancy, sets status=delivered, cancels pending reminders', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const pregnancy = await registerPregnancy(owner, patient.id);

      const res = await owner.post(
        `/api/v1/pregnancies/${pregnancy.id}/delivery`,
        sampleDeliveryBody(),
      );
      expect(res.statusCode).toBe(200);
      const body = res.json().data;
      expect(body.delivery.pregnancyId).toBe(pregnancy.id);
      expect(body.pregnancy.status).toBe('delivered');

      const pending = await prisma.reminder.count({
        where: { pregnancyId: pregnancy.id, status: 'pending' },
      });
      expect(pending).toBe(0);
    });

    it('is idempotent on the delivery id', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const pregnancy = await registerPregnancy(owner, patient.id);
      const body = sampleDeliveryBody();

      const first = await owner.post(`/api/v1/pregnancies/${pregnancy.id}/delivery`, body);
      const second = await owner.post(`/api/v1/pregnancies/${pregnancy.id}/delivery`, body);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json().data.delivery.id).toBe(first.json().data.delivery.id);
      const count = await prisma.delivery.count({ where: { id: body.id } });
      expect(count).toBe(1);
    });

    it('422s when the pregnancy is not active', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const pregnancy = await registerPregnancy(owner, patient.id);
      await owner.post(`/api/v1/pregnancies/${pregnancy.id}/delivery`, sampleDeliveryBody());

      const res = await owner.post(
        `/api/v1/pregnancies/${pregnancy.id}/delivery`,
        sampleDeliveryBody({ id: randomUUID() }),
      );
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('RULE_VIOLATION');
    });
  });
});
