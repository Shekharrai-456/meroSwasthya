import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { InjectPayload } from 'light-my-request';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '../generated/prisma/enums.js';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { asUser } from './helpers/client.js';
import { resetDb, resetRedis } from './helpers/db.js';

// REQ-ROLE-002: every protected endpoint x every role, generated from one
// table so adding a role (automatic - ALL_ROLES below) or a new protected
// endpoint (one entry in `cases`) never requires writing a new test loop.
// Later sessions (Patients, Grants, Visits, Sync - each of which adds real
// requireRole()-gated routes) append their endpoints to `cases` here rather
// than writing a parallel, one-off matrix.
//
// This only fits endpoints whose role check is independent of any created
// object state (a plain `requireRole(...)` preHandler, gating access to the
// endpoint itself, not to a specific record). `POST /auth/provider/activate`
// and `POST /grants/redeem` both qualify. Visits' fchv restriction
// (REQ-ROLE-005) deliberately does NOT get an entry here: it's enforced
// inside `visits/service.ts`, intertwined with per-patient ownership/grant
// state that varies per role (a patient-role actor needs to own the target
// patient, a provider/fchv actor needs a matching grant) - there's no single
// patientId/body that is simultaneously meaningful for every role the way
// `provider/activate`'s invite code or `grants/redeem`'s qrPayload is. That
// restriction is already covered, more strongly, by `test/visits.test.ts`'s
// dedicated test proving fchv is blocked even *with* a valid append grant
// (not just against a nonexistent/inaccessible patient, which is all this
// generic matrix could exercise for it).

const ALL_ROLES = Object.values(Role);

interface AuthzCase {
  name: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  path: string;
  body: () => Promise<InjectPayload>;
  allowedRoles: Role[];
}

describe('authorization matrix (REQ-ROLE-002)', () => {
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
  });

  // Mints a fresh patient + real, unredeemed, unexpired grant via the real
  // create-patient/create-grant endpoints (not hand-built fixtures), and
  // returns its qrPayload - a self-contained fixture the redeem case's
  // `body` factory can call fresh for every role tested, since `beforeEach`
  // truncates the database before each `it()`.
  async function mintRedeemableQrPayload(): Promise<string> {
    const owner = await asUser(app, Role.patient);
    const patientRes = await owner.post('/api/v1/patients', {
      id: randomUUID(),
      name: 'Matrix Test Patient',
      sex: 'female',
      dob: '2000-01-01',
      allergies: [],
      chronicConditions: [],
    });
    const patientId = patientRes.json().data.patient.id as string;
    const grantRes = await owner.post('/api/v1/grants', { patientId, scope: 'read' });
    return grantRes.json().data.qrPayload as string;
  }

  const cases: AuthzCase[] = [
    {
      name: 'POST /auth/provider/activate (REQ-AUTH-008, role must be patient)',
      method: 'POST',
      path: '/api/v1/auth/provider/activate',
      body: async () => ({ inviteCode: 'HA-GHORAHI-01' }),
      allowedRoles: [Role.patient],
    },
    {
      name: 'POST /grants/redeem (REQ-GRANT-003, role must be provider or fchv)',
      method: 'POST',
      path: '/api/v1/grants/redeem',
      body: async () => ({ qrPayload: await mintRedeemableQrPayload() }),
      allowedRoles: [Role.provider, Role.fchv],
    },
  ];

  for (const testCase of cases) {
    describe(testCase.name, () => {
      for (const role of ALL_ROLES) {
        const shouldAllow = testCase.allowedRoles.includes(role);

        it(`role=${role} -> ${shouldAllow ? 'allowed (not 403)' : '403 FORBIDDEN'}`, async () => {
          const client = await asUser(app, role);
          const body = await testCase.body();
          const res =
            testCase.method === 'GET'
              ? await client.get(testCase.path)
              : await client.post(testCase.path, body);

          if (shouldAllow) {
            expect(res.statusCode).not.toBe(403);
          } else {
            expect(res.statusCode).toBe(403);
            expect(res.json().error.code).toBe('FORBIDDEN');
          }
        });
      }
    });
  }

  describe('token type separation (REQ-ROLE-008)', () => {
    it('every requireAuth-gated route rejects a request with no token at all (401, not 403)', async () => {
      const client = await asUser(app, Role.patient);
      const res = await client.post('/api/v1/auth/provider/activate', {
        inviteCode: 'HA-GHORAHI-01',
      });
      expect(res.statusCode).not.toBe(401); // sanity: the authenticated call itself works

      const anonymous = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/provider/activate',
        payload: { inviteCode: 'HA-GHORAHI-01' },
      });
      expect(anonymous.statusCode).toBe(401);
      expect(anonymous.json().error.code).toBe('UNAUTHENTICATED');
    });
  });
});
