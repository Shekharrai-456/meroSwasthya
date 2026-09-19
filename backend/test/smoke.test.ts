import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '../generated/prisma/enums.js';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { testClient } from './helpers/client.js';
import { resetDb, resetRedis } from './helpers/db.js';

// REQ-TEST-004 (backend.md §12 item 10, Phase 10 hardening). The one
// dedicated cross-module script that walks the literal demo path end to
// end, exactly as a human presenter would: real OTP -> PIN-set login (not
// `asUser`'s auth-bypassing shortcut every other test file uses - the
// whole point of a smoke test is to prove the real login flow and every
// module's wiring together actually works, not just each module in
// isolation). Real Postgres + Redis throughout (CLAUDE.md §10).

const DEMO_OTP = '123456';

async function loginWithNewAccount(
  app: FastifyInstance,
  phone: string,
  name: string,
): Promise<{ accessToken: string; refreshToken: string; userId: string }> {
  const client = testClient(app);
  await client.post('/api/v1/auth/otp/request', { phone });
  const verifyRes = await client.post('/api/v1/auth/otp/verify', { phone, otp: DEMO_OTP });
  const tempToken = verifyRes.json().data.tempToken as string;
  const setPinRes = await client.post(
    '/api/v1/auth/pin/set',
    { pin: '1234', name },
    { Authorization: `Bearer ${tempToken}` },
  );
  const body = setPinRes.json().data;
  return {
    accessToken: body.accessToken as string,
    refreshToken: body.refreshToken as string,
    userId: body.user.id as string,
  };
}

function authedClient(app: FastifyInstance, accessToken: string) {
  const client = testClient(app);
  const auth = (headers?: Record<string, string>) => ({
    ...headers,
    Authorization: `Bearer ${accessToken}`,
  });
  return {
    get: (url: string) => client.get(url, auth()),
    post: (url: string, payload?: unknown) => client.post(url, payload as never, auth()),
    put: (url: string, payload?: unknown) => client.put(url, payload as never, auth()),
  };
}

describe('smoke: full demo path', () => {
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
    await prisma.facility.create({
      data: {
        id: 'f_0001',
        name: 'Ghorahi Health Post',
        type: 'health_post',
        hasBirthingCentre: false,
        lat: 28.03,
        lng: 82.48,
        municipality: 'Ghorahi',
      },
    });
    await prisma.inviteCode.create({
      data: { code: 'HA-GHORAHI-01', role: Role.provider, facilityId: 'f_0001' },
    });
    await prisma.codeListItem.createMany({
      data: [
        { kind: 'complaint', code: 'CC_FEVER', labelEn: 'Fever', labelNp: 'ज्वरो' },
        { kind: 'diagnosis', code: 'E11', labelEn: 'Type 2 diabetes', labelNp: 'मधुमेह' },
      ],
    });
  });

  it('login as owner → create patient → create grant → login as HA → redeem → add visit → register pregnancy → record contact 4 red → check timeline and /demo/sms', async () => {
    // 1. Login as owner (real OTP -> PIN-set flow, not asUser).
    const owner = await loginWithNewAccount(app, '+9779801099001', 'Smoke Owner');
    const ownerClient = authedClient(app, owner.accessToken);

    // 2. Create patient.
    const patientRes = await ownerClient.post('/api/v1/patients', {
      id: randomUUID(),
      name: 'Smoke Patient',
      sex: 'female',
      dob: '2000-01-01',
      allergies: [],
      chronicConditions: [],
    });
    expect(patientRes.statusCode).toBe(200);
    const patientId = patientRes.json().data.patient.id as string;

    // 3. Create grant.
    const grantRes = await ownerClient.post('/api/v1/grants', {
      patientId,
      scope: 'append',
      ttlMinutes: 10,
    });
    expect(grantRes.statusCode).toBe(200);
    const qrPayload = grantRes.json().data.qrPayload as string;

    // 4. Login as HA (health assistant / provider).
    let ha = await loginWithNewAccount(app, '+9779801099002', 'Smoke HA');
    let haClient = authedClient(app, ha.accessToken);
    const activateRes = await haClient.post('/api/v1/auth/provider/activate', {
      inviteCode: 'HA-GHORAHI-01',
    });
    expect(activateRes.statusCode).toBe(200);
    expect(activateRes.json().data.user.role).toBe('provider');

    // The access token issued at login still carries the pre-activation
    // "patient" role claim (JWTs are stateless - activation only updates
    // the DB row) - refresh to get a token with the new role, exactly what
    // a real client must do after this endpoint per backend.md §7.2.
    const refreshRes = await testClient(app).post('/api/v1/auth/refresh', {
      refreshToken: ha.refreshToken,
    });
    expect(refreshRes.statusCode).toBe(200);
    ha = { ...ha, accessToken: refreshRes.json().data.accessToken };
    haClient = authedClient(app, ha.accessToken);

    // 5. Redeem the grant.
    const redeemRes = await haClient.post('/api/v1/grants/redeem', { qrPayload });
    expect(redeemRes.statusCode).toBe(200);
    expect(redeemRes.json().data.patient.id).toBe(patientId);

    // 6. Add a visit.
    const visitRes = await haClient.post(`/api/v1/patients/${patientId}/visits`, {
      id: randomUUID(),
      visitAt: new Date().toISOString(),
      chiefComplaintCode: 'CC_FEVER',
      vitals: { tempC: 38.2 },
      diagnosisCodes: ['E11'],
      prescriptions: [],
    });
    expect(visitRes.statusCode).toBe(200);

    // 7. Register a pregnancy.
    const pregRes = await haClient.post(`/api/v1/patients/${patientId}/pregnancies`, {
      id: randomUUID(),
      lmp: '2026-02-20',
      gravida: 1,
      para: 0,
      riskFactors: [],
    });
    expect(pregRes.statusCode).toBe(200);
    const pregnancy = pregRes.json().data.pregnancy;
    const ancContacts = pregRes.json().data.ancContacts as { contactNo: number }[];
    const contact4 = ancContacts.find((c) => c.contactNo === 4);
    expect(contact4).toBeDefined();

    // 8. Record contact 4 with findings that trigger a red triage result
    // (severe hypertension, A.6 case-style: bpSys >= 160 alone is red).
    const recordRes = await haClient.put(`/api/v1/pregnancies/${pregnancy.id}/contacts/4`, {
      doneAt: new Date().toISOString(),
      findings: { bpSys: 170, bpDia: 115 },
      dangerSigns: [],
      referral: null,
    });
    expect(recordRes.statusCode).toBe(200);
    expect(recordRes.json().data.ancContact.triageLevel).toBe('red');

    // 9. Check the patient's timeline shows the new records, including the
    // red-badged anc_contact.
    const timelineRes = await ownerClient.get(`/api/v1/patients/${patientId}/timeline`);
    expect(timelineRes.statusCode).toBe(200);
    const timelineItems = timelineRes.json().data.items as {
      kind: string;
      badge: string | null;
    }[];
    expect(timelineItems.some((item) => item.kind === 'visit')).toBe(true);
    expect(timelineItems.some((item) => item.kind === 'pregnancy_registered')).toBe(true);
    expect(timelineItems.some((item) => item.kind === 'anc_contact' && item.badge === 'red')).toBe(
      true,
    );

    // 10. Check /demo/sms (no auth - the projector page).
    const smsRes = await testClient(app).get('/api/v1/demo/sms');
    expect(smsRes.statusCode).toBe(200);
  });
});
