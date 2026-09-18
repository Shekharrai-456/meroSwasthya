import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GrantScope, Role } from '../generated/prisma/enums.js';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { asUser, testClient } from './helpers/client.js';
import { resetDb, resetRedis } from './helpers/db.js';
import { countQueries } from './helpers/queryCount.js';

// REQ-PATIENT-*, REQ-ROLE-003/004/006/007. Real Postgres + Redis throughout
// (CLAUDE.md §10) - no mocked database.
//
// Session 6 frontend-contract audit finding: POST/GET-one/PATCH /patients
// all wrap the entity as { "patient": <Patient> } per backend.md's own A.4
// examples - a bug found here (assertions previously read `data.id`
// directly) that also existed in the real route code until this session.
// GET /patients (list) and GET /patients/:id/audit stay `{ items: [...] }`.

function samplePatientBody(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    name: 'Sita Chaudhary',
    sex: 'female',
    dob: '2002-03-15',
    bloodGroup: 'B+',
    ward: 5,
    municipality: 'Ghorahi',
    allergies: ['penicillin'],
    chronicConditions: [],
    emergencyContactPhone: '+9779801000099',
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
      scope: opts.scope ?? GrantScope.read,
      tokenJti: randomUUID(),
      expiresAt: new Date(Date.now() + 600_000),
      redeemedByUserId,
      redeemedAt: new Date(),
      accessUntil: opts.expired ? new Date(Date.now() - 1000) : new Date(Date.now() + 86_400_000),
      revokedAt: opts.revoked ? new Date() : null,
    },
  });
}

describe('patients module', () => {
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

  describe('POST /api/v1/patients (REQ-PATIENT-001/002)', () => {
    it('creates a patient with a client-generated id, wrapped as { patient }', async () => {
      const owner = await asUser(app, Role.patient);
      const body = samplePatientBody();
      const res = await owner.post('/api/v1/patients', body);
      expect(res.statusCode).toBe(200);
      const patient = res.json().data.patient;
      expect(patient.id).toBe(body.id);
      expect(patient.ownerUserId).toBe(owner.user.id);
      expect(patient.version).toBe(1);
      expect(patient.allergies).toEqual(['penicillin']);
      expect(patient.dob).toBe('2002-03-15');
    });

    it('is idempotent: posting the same id twice for the same owner returns the existing row', async () => {
      const owner = await asUser(app, Role.patient);
      const body = samplePatientBody();
      const first = await owner.post('/api/v1/patients', body);
      const second = await owner.post('/api/v1/patients', body);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json().data.patient.version).toBe(1);
      const count = await prisma.patient.count({ where: { id: body.id } });
      expect(count).toBe(1);
    });

    it('403 FORBIDDEN when the same id is posted under a different owner', async () => {
      const ownerA = await asUser(app, Role.patient);
      const ownerB = await asUser(app, Role.patient);
      const body = samplePatientBody();
      await ownerA.post('/api/v1/patients', body);
      const res = await ownerB.post('/api/v1/patients', body);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    });

    it('defaults allergies/chronicConditions to [] when omitted', async () => {
      const owner = await asUser(app, Role.patient);
      const body = samplePatientBody();
      delete (body as Record<string, unknown>).allergies;
      delete (body as Record<string, unknown>).chronicConditions;
      const res = await owner.post('/api/v1/patients', body);
      expect(res.json().data.patient.allergies).toEqual([]);
      expect(res.json().data.patient.chronicConditions).toEqual([]);
    });

    it('401 with no token', async () => {
      const res = await testClient(app).post('/api/v1/patients', samplePatientBody());
      expect(res.statusCode).toBe(401);
    });

    it('400 VALIDATION_ERROR on a non-uuid id', async () => {
      const owner = await asUser(app, Role.patient);
      const res = await owner.post('/api/v1/patients', samplePatientBody({ id: 'not-a-uuid' }));
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('400 VALIDATION_ERROR on an empty name', async () => {
      const owner = await asUser(app, Role.patient);
      const res = await owner.post('/api/v1/patients', samplePatientBody({ name: '' }));
      expect(res.statusCode).toBe(400);
    });

    it('400 VALIDATION_ERROR on an invalid sex value', async () => {
      const owner = await asUser(app, Role.patient);
      const res = await owner.post('/api/v1/patients', samplePatientBody({ sex: 'unknown' }));
      expect(res.statusCode).toBe(400);
    });

    it('400 VALIDATION_ERROR on a malformed dob', async () => {
      const owner = await asUser(app, Role.patient);
      const res = await owner.post('/api/v1/patients', samplePatientBody({ dob: '15-03-2002' }));
      expect(res.statusCode).toBe(400);
    });
  });

  describe('PATCH /api/v1/patients/:id (REQ-PATIENT-003)', () => {
    async function createPatient(owner: Awaited<ReturnType<typeof asUser>>) {
      const body = samplePatientBody();
      const res = await owner.post('/api/v1/patients', body);
      return res.json().data.patient as { id: string; version: number };
    }

    it('updates fields and increments version, wrapped as { patient }', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const res = await owner.patch(`/api/v1/patients/${patient.id}`, {
        version: 1,
        name: 'Sita C. Updated',
        ward: 7,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.patient.name).toBe('Sita C. Updated');
      expect(res.json().data.patient.ward).toBe(7);
      expect(res.json().data.patient.version).toBe(2);
    });

    it('409 VERSION_CONFLICT on a stale version, with details.current the real row (bare, not wrapped)', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      await owner.patch(`/api/v1/patients/${patient.id}`, { version: 1, name: 'First edit' });

      const res = await owner.patch(`/api/v1/patients/${patient.id}`, {
        version: 1,
        name: 'Stale edit',
      });
      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.error.code).toBe('VERSION_CONFLICT');
      // details.current is the bare entity (error-envelope convention,
      // docs/API_CONTRACT.md §4) - deliberately NOT wrapped in { patient },
      // unlike the success envelope.
      expect(body.error.details.current.version).toBe(2);
      expect(body.error.details.current.name).toBe('First edit');
    });

    it('boundary: version exactly matching current succeeds; off-by-one in either direction fails', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);

      const tooHigh = await owner.patch(`/api/v1/patients/${patient.id}`, {
        version: 2,
        name: 'x',
      });
      expect(tooHigh.statusCode).toBe(409);

      const exact = await owner.patch(`/api/v1/patients/${patient.id}`, { version: 1, name: 'x' });
      expect(exact.statusCode).toBe(200);

      const nowStale = await owner.patch(`/api/v1/patients/${patient.id}`, {
        version: 1,
        name: 'y',
      });
      expect(nowStale.statusCode).toBe(409);
    });

    it('403 FORBIDDEN when a non-owner (even with an active append grant) tries to PATCH', async () => {
      const owner = await asUser(app, Role.patient);
      const provider = await asUser(app, Role.provider);
      const patient = await createPatient(owner);
      await createGrant(patient.id, provider.user.id, { scope: GrantScope.append });

      const res = await provider.patch(`/api/v1/patients/${patient.id}`, {
        version: 1,
        name: 'hijack',
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    });

    it('404 NOT_FOUND on an unknown id', async () => {
      const owner = await asUser(app, Role.patient);
      const res = await owner.patch(`/api/v1/patients/${randomUUID()}`, { version: 1, name: 'x' });
      expect(res.statusCode).toBe(404);
    });

    it('401 with no token', async () => {
      const res = await testClient(app).patch(`/api/v1/patients/${randomUUID()}`, { version: 1 });
      expect(res.statusCode).toBe(401);
    });

    it('400 VALIDATION_ERROR on an invalid sex value', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatient(owner);
      const res = await owner.patch(`/api/v1/patients/${patient.id}`, {
        version: 1,
        sex: 'invalid',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/patients (REQ-ROLE-007)', () => {
    it('patient role sees only their own patients', async () => {
      const ownerA = await asUser(app, Role.patient);
      const ownerB = await asUser(app, Role.patient);
      await ownerA.post('/api/v1/patients', samplePatientBody());
      await ownerB.post('/api/v1/patients', samplePatientBody());

      const res = await ownerA.get('/api/v1/patients');
      expect(res.statusCode).toBe(200);
      const items = res.json().data.items;
      expect(items).toHaveLength(1);
      expect(items[0].ownerUserId).toBe(ownerA.user.id);
    });

    it('provider role sees owned patients union active-grant patients', async () => {
      const owner = await asUser(app, Role.patient);
      const provider = await asUser(app, Role.provider);
      const ownPatientRes = await provider.post('/api/v1/patients', samplePatientBody());
      const grantedPatientRes = await owner.post('/api/v1/patients', samplePatientBody());
      await createGrant(grantedPatientRes.json().data.patient.id, provider.user.id);

      // A third patient the provider has no relationship to at all.
      const otherOwner = await asUser(app, Role.patient);
      await otherOwner.post('/api/v1/patients', samplePatientBody());

      const res = await provider.get('/api/v1/patients');
      const ids = res.json().data.items.map((p: { id: string }) => p.id);
      expect(ids).toHaveLength(2);
      expect(ids).toContain(ownPatientRes.json().data.patient.id);
      expect(ids).toContain(grantedPatientRes.json().data.patient.id);
    });

    it('an expired or revoked grant does not appear in the provider list', async () => {
      const owner = await asUser(app, Role.patient);
      const provider = await asUser(app, Role.provider);
      const expiredPatient = await owner.post('/api/v1/patients', samplePatientBody());
      const revokedPatient = await owner.post('/api/v1/patients', samplePatientBody());
      await createGrant(expiredPatient.json().data.patient.id, provider.user.id, { expired: true });
      await createGrant(revokedPatient.json().data.patient.id, provider.user.id, { revoked: true });

      const res = await provider.get('/api/v1/patients');
      expect(res.json().data.items).toHaveLength(0);
    });

    it('returns an empty list, not an error, when the caller owns nothing', async () => {
      const owner = await asUser(app, Role.patient);
      const res = await owner.get('/api/v1/patients');
      expect(res.statusCode).toBe(200);
      expect(res.json().data.items).toEqual([]);
    });

    it('401 with no token', async () => {
      const res = await testClient(app).get('/api/v1/patients');
      expect(res.statusCode).toBe(401);
    });

    it('runs a bounded number of queries regardless of how many patients are returned (no N+1)', async () => {
      const owner = await asUser(app, Role.patient);
      for (let i = 0; i < 8; i++) {
        await owner.post('/api/v1/patients', samplePatientBody());
      }
      const queryCount = await countQueries(async () => {
        const res = await owner.get('/api/v1/patients');
        expect(res.json().data.items).toHaveLength(8);
      });
      // One query for the caller's own list; provider/fchv paths add one more
      // for the grants lookup. Patient role should never scale with row count.
      expect(queryCount).toBeLessThanOrEqual(2);
    });
  });

  describe('GET /api/v1/patients/:id (REQ-PATIENT-004, REQ-ROLE-003, REQ-ROLE-006)', () => {
    it('owner can read their own patient, wrapped as { patient }', async () => {
      const owner = await asUser(app, Role.patient);
      const created = await owner.post('/api/v1/patients', samplePatientBody());
      const res = await owner.get(`/api/v1/patients/${created.json().data.patient.id}`);
      expect(res.statusCode).toBe(200);
      expect(res.json().data.patient.id).toBe(created.json().data.patient.id);
    });

    it('403 FORBIDDEN for a provider with no grant (object-level boundary)', async () => {
      const owner = await asUser(app, Role.patient);
      const provider = await asUser(app, Role.provider);
      const created = await owner.post('/api/v1/patients', samplePatientBody());
      const res = await provider.get(`/api/v1/patients/${created.json().data.patient.id}`);
      expect(res.statusCode).toBe(403);
    });

    it('200 for a provider with an active grant, and 403 again once the grant expires', async () => {
      const owner = await asUser(app, Role.patient);
      const provider = await asUser(app, Role.provider);
      const created = await owner.post('/api/v1/patients', samplePatientBody());
      const patientId = created.json().data.patient.id;
      await createGrant(patientId, provider.user.id);

      const allowed = await provider.get(`/api/v1/patients/${patientId}`);
      expect(allowed.statusCode).toBe(200);

      await prisma.accessGrant.updateMany({
        where: { patientId, redeemedByUserId: provider.user.id },
        data: { accessUntil: new Date(Date.now() - 1000) },
      });
      const expired = await provider.get(`/api/v1/patients/${patientId}`);
      expect(expired.statusCode).toBe(403);
    });

    it('403 once a grant is revoked, even if still within its access window', async () => {
      const owner = await asUser(app, Role.patient);
      const provider = await asUser(app, Role.provider);
      const created = await owner.post('/api/v1/patients', samplePatientBody());
      const patientId = created.json().data.patient.id;
      await createGrant(patientId, provider.user.id, { revoked: true });

      const res = await provider.get(`/api/v1/patients/${patientId}`);
      expect(res.statusCode).toBe(403);
    });

    it('fchv role is gated identically to provider (object-level, not role-level)', async () => {
      const owner = await asUser(app, Role.patient);
      const fchv = await asUser(app, Role.fchv);
      const created = await owner.post('/api/v1/patients', samplePatientBody());
      const patientId = created.json().data.patient.id;

      const denied = await fchv.get(`/api/v1/patients/${patientId}`);
      expect(denied.statusCode).toBe(403);

      await createGrant(patientId, fchv.user.id);
      const allowed = await fchv.get(`/api/v1/patients/${patientId}`);
      expect(allowed.statusCode).toBe(200);
    });

    it('404 NOT_FOUND on an unknown id', async () => {
      const owner = await asUser(app, Role.patient);
      const res = await owner.get(`/api/v1/patients/${randomUUID()}`);
      expect(res.statusCode).toBe(404);
    });

    it('401 with no token', async () => {
      const res = await testClient(app).get(`/api/v1/patients/${randomUUID()}`);
      expect(res.statusCode).toBe(401);
    });

    it('a provider reading via a grant writes a throttled record_viewed audit row (REQ-ROLE-006)', async () => {
      const owner = await asUser(app, Role.patient);
      const provider = await asUser(app, Role.provider);
      const created = await owner.post('/api/v1/patients', samplePatientBody());
      const patientId = created.json().data.patient.id;
      await createGrant(patientId, provider.user.id);

      await provider.get(`/api/v1/patients/${patientId}`);
      await provider.get(`/api/v1/patients/${patientId}`);
      await provider.get(`/api/v1/patients/${patientId}`);

      const entries = await prisma.auditEntry.findMany({
        where: { patientId, action: 'record_viewed' },
      });
      expect(entries).toHaveLength(1); // throttled to once per 10 min
      expect(entries[0]?.actorUserId).toBe(provider.user.id);
    });

    it('the owner reading their own record never writes a record_viewed audit row', async () => {
      const owner = await asUser(app, Role.patient);
      const created = await owner.post('/api/v1/patients', samplePatientBody());
      await owner.get(`/api/v1/patients/${created.json().data.patient.id}`);

      const entries = await prisma.auditEntry.findMany({ where: { action: 'record_viewed' } });
      expect(entries).toHaveLength(0);
    });
  });

  describe('GET /api/v1/patients/:id/audit (REQ-PATIENT-010, REQ-AUDIT-003)', () => {
    it('owner sees audit entries, newest first', async () => {
      const owner = await asUser(app, Role.patient);
      const provider = await asUser(app, Role.provider);
      const created = await owner.post('/api/v1/patients', samplePatientBody());
      const patientId = created.json().data.patient.id;
      await createGrant(patientId, provider.user.id);
      await provider.get(`/api/v1/patients/${patientId}`);

      const res = await owner.get(`/api/v1/patients/${patientId}/audit`);
      expect(res.statusCode).toBe(200);
      const items = res.json().data.items;
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items[0].action).toBe('record_viewed');
      expect(items[0].actorUserId).toBe(provider.user.id);
    });

    it('403 FORBIDDEN for a non-owner, even one holding an active read grant', async () => {
      const owner = await asUser(app, Role.patient);
      const provider = await asUser(app, Role.provider);
      const created = await owner.post('/api/v1/patients', samplePatientBody());
      const patientId = created.json().data.patient.id;
      await createGrant(patientId, provider.user.id);

      const res = await provider.get(`/api/v1/patients/${patientId}/audit`);
      expect(res.statusCode).toBe(403);
    });

    it('404 NOT_FOUND on an unknown id', async () => {
      const owner = await asUser(app, Role.patient);
      const res = await owner.get(`/api/v1/patients/${randomUUID()}/audit`);
      expect(res.statusCode).toBe(404);
    });

    it('401 with no token', async () => {
      const res = await testClient(app).get(`/api/v1/patients/${randomUUID()}/audit`);
      expect(res.statusCode).toBe(401);
    });
  });

  describe('integration: full flow as the frontend would perform it', () => {
    it('create -> grant (simulated) -> provider views -> owner sees audit -> owner edits -> stale edit rejected', async () => {
      const owner = await asUser(app, Role.patient, { name: 'Owner' });
      const provider = await asUser(app, Role.provider, { name: 'Dr. Provider' });

      const createRes = await owner.post('/api/v1/patients', samplePatientBody());
      expect(createRes.statusCode).toBe(200);
      const patientId = createRes.json().data.patient.id;

      await createGrant(patientId, provider.user.id, { scope: GrantScope.append });

      const viewRes = await provider.get(`/api/v1/patients/${patientId}`);
      expect(viewRes.statusCode).toBe(200);

      const auditRes = await owner.get(`/api/v1/patients/${patientId}/audit`);
      expect(
        auditRes.json().data.items.some((e: { action: string }) => e.action === 'record_viewed'),
      ).toBe(true);

      const editRes = await owner.patch(`/api/v1/patients/${patientId}`, {
        version: 1,
        ward: 9,
      });
      expect(editRes.statusCode).toBe(200);
      expect(editRes.json().data.patient.version).toBe(2);

      const staleRes = await owner.patch(`/api/v1/patients/${patientId}`, {
        version: 1,
        ward: 99,
      });
      expect(staleRes.statusCode).toBe(409);

      const finalRes = await owner.get(`/api/v1/patients/${patientId}`);
      expect(finalRes.json().data.patient.ward).toBe(9);
    });
  });
});
