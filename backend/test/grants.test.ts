import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '../generated/prisma/enums.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { prisma } from '../src/lib/prisma.js';
import { asUser, testClient } from './helpers/client.js';
import { resetDb, resetRedis } from './helpers/db.js';

// REQ-GRANT-*, REQ-TEST-003. Real Postgres + Redis throughout (CLAUDE.md §10).

function samplePatientBody(overrides: Record<string, unknown> = {}) {
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

async function craftGrantToken(
  payload: Record<string, unknown>,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(new TextEncoder().encode(secret));
}

describe('grants module', () => {
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

  async function createPatientAs(owner: Awaited<ReturnType<typeof asUser>>) {
    // Session 6 frontend-contract audit finding: POST /patients wraps its
    // response as { patient: <Patient> } per backend.md's A.4 examples - this
    // helper (and the real route) previously assumed the bare shape.
    const res = await owner.post('/api/v1/patients', samplePatientBody());
    return res.json().data.patient as { id: string };
  }

  describe('POST /api/v1/grants (REQ-GRANT-001/002)', () => {
    it('creates a grant and returns a "SWC1:"-prefixed qrPayload', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatientAs(owner);

      const res = await owner.post('/api/v1/grants', {
        patientId: patient.id,
        scope: 'append',
        ttlMinutes: 10,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json().data;
      expect(body.qrPayload).toBe(`SWC1:${body.token}`);
      expect(body.grant.scope).toBe('append');
      expect(body.grant.patientId).toBe(patient.id);
      expect(body.grant.redeemedByUserId).toBeNull();
    });

    it('defaults ttlMinutes to config.GRANT_TTL_MIN_DEFAULT when omitted', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatientAs(owner);
      const before = Date.now();
      const res = await owner.post('/api/v1/grants', { patientId: patient.id, scope: 'read' });
      const expiresAt = new Date(res.json().data.grant.expiresAt).getTime();
      const expectedMs = config.GRANT_TTL_MIN_DEFAULT * 60 * 1000;
      expect(expiresAt).toBeGreaterThanOrEqual(before + expectedMs - 5000);
      expect(expiresAt).toBeLessThanOrEqual(before + expectedMs + 5000);
    });

    it('writes a grant_created audit entry', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatientAs(owner);
      const res = await owner.post('/api/v1/grants', { patientId: patient.id, scope: 'read' });
      const entries = await prisma.auditEntry.findMany({
        where: { patientId: patient.id, action: 'grant_created' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.grantId).toBe(res.json().data.grant.id);
    });

    it('404 NOT_FOUND on an unknown patientId', async () => {
      const owner = await asUser(app, Role.patient);
      const res = await owner.post('/api/v1/grants', { patientId: randomUUID(), scope: 'read' });
      expect(res.statusCode).toBe(404);
    });

    // Session 8 security-review finding: ttlMinutes previously had no upper
    // bound, letting a caller mint a long-lived unprotected QR grant.
    it('rejects a ttlMinutes above the 60-minute cap', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatientAs(owner);
      const res = await owner.post('/api/v1/grants', {
        patientId: patient.id,
        scope: 'read',
        ttlMinutes: 61,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts ttlMinutes exactly at the 60-minute cap', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatientAs(owner);
      const res = await owner.post('/api/v1/grants', {
        patientId: patient.id,
        scope: 'read',
        ttlMinutes: 60,
      });
      expect(res.statusCode).toBe(200);
    });

    it('403 FORBIDDEN when the caller does not own the patient', async () => {
      const owner = await asUser(app, Role.patient);
      const stranger = await asUser(app, Role.patient);
      const patient = await createPatientAs(owner);
      const res = await stranger.post('/api/v1/grants', { patientId: patient.id, scope: 'read' });
      expect(res.statusCode).toBe(403);
    });

    it('401 with no token', async () => {
      const res = await testClient(app).post('/api/v1/grants', {
        patientId: randomUUID(),
        scope: 'read',
      });
      expect(res.statusCode).toBe(401);
    });

    it('400 VALIDATION_ERROR on an invalid scope', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatientAs(owner);
      const res = await owner.post('/api/v1/grants', { patientId: patient.id, scope: 'admin' });
      expect(res.statusCode).toBe(400);
    });

    it('429 RATE_LIMITED on the 21st grant for the same patient within an hour', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatientAs(owner);
      for (let i = 0; i < 20; i++) {
        const res = await owner.post('/api/v1/grants', { patientId: patient.id, scope: 'read' });
        expect(res.statusCode).toBe(200);
      }
      const res = await owner.post('/api/v1/grants', { patientId: patient.id, scope: 'read' });
      expect(res.statusCode).toBe(429);
    });
  });

  describe('POST /api/v1/grants/redeem (REQ-GRANT-003..007)', () => {
    async function issueGrant(
      owner: Awaited<ReturnType<typeof asUser>>,
      patientId: string,
      overrides: Record<string, unknown> = {},
    ) {
      const res = await owner.post('/api/v1/grants', {
        patientId,
        scope: 'append',
        ttlMinutes: 10,
        ...overrides,
      });
      return res.json().data as { qrPayload: string; grant: { id: string } };
    }

    it('provider redeems successfully and receives the patient bundle', async () => {
      const owner = await asUser(app, Role.patient);
      const provider = await asUser(app, Role.provider);
      const patient = await createPatientAs(owner);
      const { qrPayload } = await issueGrant(owner, patient.id);

      const res = await provider.post('/api/v1/grants/redeem', { qrPayload });
      expect(res.statusCode).toBe(200);
      const body = res.json().data;
      expect(body.patient.id).toBe(patient.id);
      expect(body.grant.redeemedByUserId).toBe(provider.user.id);
      expect(body.grant.accessUntil).not.toBeNull();
    });

    // REQ-GRANT-007: full offline bundle - summary, timeline, active
    // pregnancy, and all its ANC contacts, reusing the same builders as
    // GET /patients/:id and GET /patients/:id/timeline.
    it('bundle includes summary, timeline, active pregnancy, and its anc contacts', async () => {
      const owner = await asUser(app, Role.patient);
      const provider = await asUser(app, Role.provider);
      const patient = await createPatientAs(owner);

      const pregRes = await owner.post(`/api/v1/patients/${patient.id}/pregnancies`, {
        id: randomUUID(),
        lmp: '2026-02-20',
        gravida: 1,
        para: 0,
        riskFactors: [],
      });
      const { pregnancy, ancContacts } = pregRes.json().data;

      const { qrPayload } = await issueGrant(owner, patient.id);
      const res = await provider.post('/api/v1/grants/redeem', { qrPayload });
      const body = res.json().data;

      expect(body.summary.activePregnancy.id).toBe(pregnancy.id);
      expect(body.pregnancy.id).toBe(pregnancy.id);
      expect(body.ancContacts).toHaveLength(ancContacts.length);
      expect(
        body.timeline.some((item: { kind: string }) => item.kind === 'pregnancy_registered'),
      ).toBe(true);
    });

    it('bundle has an empty ancContacts array and null pregnancy when there is no active pregnancy', async () => {
      const owner = await asUser(app, Role.patient);
      const provider = await asUser(app, Role.provider);
      const patient = await createPatientAs(owner);
      const { qrPayload } = await issueGrant(owner, patient.id);

      const res = await provider.post('/api/v1/grants/redeem', { qrPayload });
      const body = res.json().data;
      expect(body.pregnancy).toBeNull();
      expect(body.ancContacts).toEqual([]);
      expect(body.summary.visitCount).toBe(0);
    });

    it('grants real access: a redeemed grant lets the provider read the patient (integration with Session 4)', async () => {
      const owner = await asUser(app, Role.patient);
      const provider = await asUser(app, Role.provider);
      const patient = await createPatientAs(owner);
      const { qrPayload } = await issueGrant(owner, patient.id);

      const before = await provider.get(`/api/v1/patients/${patient.id}`);
      expect(before.statusCode).toBe(403);

      await provider.post('/api/v1/grants/redeem', { qrPayload });

      const after = await provider.get(`/api/v1/patients/${patient.id}`);
      expect(after.statusCode).toBe(200);
    });

    it('403 FORBIDDEN when redeemed by a role other than provider/fchv', async () => {
      const owner = await asUser(app, Role.patient);
      const otherPatientUser = await asUser(app, Role.patient);
      const patient = await createPatientAs(owner);
      const { qrPayload } = await issueGrant(owner, patient.id);

      const res = await otherPatientUser.post('/api/v1/grants/redeem', { qrPayload });
      expect(res.statusCode).toBe(403);
    });

    it('fchv role can redeem too', async () => {
      const owner = await asUser(app, Role.patient);
      const fchv = await asUser(app, Role.fchv);
      const patient = await createPatientAs(owner);
      const { qrPayload } = await issueGrant(owner, patient.id);

      const res = await fchv.post('/api/v1/grants/redeem', { qrPayload });
      expect(res.statusCode).toBe(200);
    });

    it('GRANT_EXPIRED when the grant has expired', async () => {
      const owner = await asUser(app, Role.patient);
      const provider = await asUser(app, Role.provider);
      const patient = await createPatientAs(owner);
      const { qrPayload, grant } = await issueGrant(owner, patient.id);
      await prisma.accessGrant.update({
        where: { id: grant.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await provider.post('/api/v1/grants/redeem', { qrPayload });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('GRANT_EXPIRED');
    });

    it('GRANT_EXPIRED when the grant has been revoked before redemption', async () => {
      const owner = await asUser(app, Role.patient);
      const provider = await asUser(app, Role.provider);
      const patient = await createPatientAs(owner);
      const { qrPayload, grant } = await issueGrant(owner, patient.id);
      await owner.post(`/api/v1/grants/${grant.id}/revoke`, {});

      const res = await provider.post('/api/v1/grants/redeem', { qrPayload });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('GRANT_EXPIRED');
    });

    it('GRANT_EXPIRED on a tampered signature', async () => {
      const provider = await asUser(app, Role.provider);
      const forged = await craftGrantToken(
        { typ: 'grant', gid: randomUUID(), pid: randomUUID(), scope: 'read' },
        'a-completely-wrong-secret-that-is-32-chars',
        600,
      );
      const res = await provider.post('/api/v1/grants/redeem', { qrPayload: `SWC1:${forged}` });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('GRANT_EXPIRED');
    });

    it('GRANT_EXPIRED on a well-signed but unknown gid (never issued)', async () => {
      const provider = await asUser(app, Role.provider);
      const forged = await craftGrantToken(
        { typ: 'grant', gid: randomUUID(), pid: randomUUID(), scope: 'read' },
        config.GRANT_SECRET,
        600,
      );
      const res = await provider.post('/api/v1/grants/redeem', { qrPayload: `SWC1:${forged}` });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('GRANT_EXPIRED');
    });

    it('400 VALIDATION_ERROR when the payload is missing the "SWC1:" prefix', async () => {
      const provider = await asUser(app, Role.provider);
      const res = await provider.post('/api/v1/grants/redeem', {
        qrPayload: 'not-a-grant-payload',
      });
      expect(res.statusCode).toBe(400);
    });

    it('is idempotent for the same redeemer: redeeming twice succeeds both times with one audit row', async () => {
      const owner = await asUser(app, Role.patient);
      const provider = await asUser(app, Role.provider);
      const patient = await createPatientAs(owner);
      const { qrPayload } = await issueGrant(owner, patient.id);

      const first = await provider.post('/api/v1/grants/redeem', { qrPayload });
      const second = await provider.post('/api/v1/grants/redeem', { qrPayload });
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);

      const entries = await prisma.auditEntry.findMany({
        where: { patientId: patient.id, action: 'grant_redeemed' },
      });
      expect(entries).toHaveLength(1);
    });

    it('409 ALREADY_REDEEMED when a different user tries to redeem an already-redeemed grant', async () => {
      const owner = await asUser(app, Role.patient);
      const providerA = await asUser(app, Role.provider);
      const providerB = await asUser(app, Role.provider);
      const patient = await createPatientAs(owner);
      const { qrPayload } = await issueGrant(owner, patient.id);

      await providerA.post('/api/v1/grants/redeem', { qrPayload });
      const res = await providerB.post('/api/v1/grants/redeem', { qrPayload });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('ALREADY_REDEEMED');
    });

    it('401 with no token', async () => {
      const res = await testClient(app).post('/api/v1/grants/redeem', { qrPayload: 'SWC1:x' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/v1/grants/:id/revoke (REQ-GRANT-008/009)', () => {
    it('owner revokes; revokedAt is set and a grant_revoked audit row is written', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatientAs(owner);
      const createRes = await owner.post('/api/v1/grants', {
        patientId: patient.id,
        scope: 'read',
      });
      const grantId = createRes.json().data.grant.id;

      const res = await owner.post(`/api/v1/grants/${grantId}/revoke`, {});
      expect(res.statusCode).toBe(200);
      expect(res.json().data.grant.revokedAt).not.toBeNull();

      const entries = await prisma.auditEntry.findMany({
        where: { patientId: patient.id, action: 'grant_revoked' },
      });
      expect(entries).toHaveLength(1);
    });

    it('access ends immediately: a redeemed-then-revoked grant loses canReadPatient access (REQ-GRANT-009)', async () => {
      const owner = await asUser(app, Role.patient);
      const provider = await asUser(app, Role.provider);
      const patient = await createPatientAs(owner);
      const createRes = await owner.post('/api/v1/grants', {
        patientId: patient.id,
        scope: 'read',
      });
      const { qrPayload, grant } = createRes.json().data;

      await provider.post('/api/v1/grants/redeem', { qrPayload });
      expect((await provider.get(`/api/v1/patients/${patient.id}`)).statusCode).toBe(200);

      await owner.post(`/api/v1/grants/${grant.id}/revoke`, {});
      expect((await provider.get(`/api/v1/patients/${patient.id}`)).statusCode).toBe(403);
    });

    it('is idempotent: revoking an already-revoked grant does not error or double-audit', async () => {
      const owner = await asUser(app, Role.patient);
      const patient = await createPatientAs(owner);
      const createRes = await owner.post('/api/v1/grants', {
        patientId: patient.id,
        scope: 'read',
      });
      const grantId = createRes.json().data.grant.id;

      await owner.post(`/api/v1/grants/${grantId}/revoke`, {});
      const second = await owner.post(`/api/v1/grants/${grantId}/revoke`, {});
      expect(second.statusCode).toBe(200);

      const entries = await prisma.auditEntry.findMany({
        where: { patientId: patient.id, action: 'grant_revoked' },
      });
      expect(entries).toHaveLength(1);
    });

    it('403 FORBIDDEN when a non-owner tries to revoke', async () => {
      const owner = await asUser(app, Role.patient);
      const stranger = await asUser(app, Role.patient);
      const patient = await createPatientAs(owner);
      const createRes = await owner.post('/api/v1/grants', {
        patientId: patient.id,
        scope: 'read',
      });
      const grantId = createRes.json().data.grant.id;

      const res = await stranger.post(`/api/v1/grants/${grantId}/revoke`, {});
      expect(res.statusCode).toBe(403);
    });

    it('404 NOT_FOUND on an unknown grant id', async () => {
      const owner = await asUser(app, Role.patient);
      const res = await owner.post(`/api/v1/grants/${randomUUID()}/revoke`, {});
      expect(res.statusCode).toBe(404);
    });

    it('401 with no token', async () => {
      const res = await testClient(app).post(`/api/v1/grants/${randomUUID()}/revoke`, {});
      expect(res.statusCode).toBe(401);
    });
  });

  describe('full lifecycle (REQ-TEST-003)', () => {
    it('create -> redeem -> access granted -> 24h boundary -> expired -> revoke on a fresh grant -> access denied', async () => {
      const owner = await asUser(app, Role.patient, { name: 'Owner' });
      const provider = await asUser(app, Role.provider, { name: 'Dr. Provider' });
      const patient = await createPatientAs(owner);

      // Create.
      const createRes = await owner.post('/api/v1/grants', {
        patientId: patient.id,
        scope: 'append',
        ttlMinutes: 10,
      });
      expect(createRes.statusCode).toBe(200);
      const { qrPayload, grant } = createRes.json().data;

      // Redeem.
      const redeemRes = await provider.post('/api/v1/grants/redeem', { qrPayload });
      expect(redeemRes.statusCode).toBe(200);

      // Access granted, including append (owner-equivalent for this patient).
      expect((await provider.get(`/api/v1/patients/${patient.id}`)).statusCode).toBe(200);

      // 24h access window boundary (A.6#16 equivalent): just past accessUntil -> denied.
      await prisma.accessGrant.update({
        where: { id: grant.id },
        data: { accessUntil: new Date(Date.now() - 1000) },
      });
      expect((await provider.get(`/api/v1/patients/${patient.id}`)).statusCode).toBe(403);

      // A second, fresh grant: revoke before it's ever redeemed.
      const secondGrantRes = await owner.post('/api/v1/grants', {
        patientId: patient.id,
        scope: 'read',
      });
      const secondGrant = secondGrantRes.json().data.grant;
      const revokeRes = await owner.post(`/api/v1/grants/${secondGrant.id}/revoke`, {});
      expect(revokeRes.statusCode).toBe(200);

      const redeemRevokedRes = await provider.post('/api/v1/grants/redeem', {
        qrPayload: secondGrantRes.json().data.qrPayload,
      });
      expect(redeemRevokedRes.statusCode).toBe(403);
      expect(redeemRevokedRes.json().error.code).toBe('GRANT_EXPIRED');
    });
  });
});
