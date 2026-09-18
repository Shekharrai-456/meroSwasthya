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
// Only one such endpoint exists as of Phase 2 (Auth/RBAC/Users) -
// POST /auth/provider/activate. Later sessions (Patients, Grants, Visits,
// Sync - each of which adds real requireRole()-gated routes) append their
// endpoints to `cases` here rather than writing a parallel, one-off matrix.

const ALL_ROLES = Object.values(Role);

interface AuthzCase {
  name: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  path: string;
  body?: InjectPayload;
  allowedRoles: Role[];
}

const cases: AuthzCase[] = [
  {
    name: 'POST /auth/provider/activate (REQ-AUTH-008, role must be patient)',
    method: 'POST',
    path: '/api/v1/auth/provider/activate',
    body: { inviteCode: 'HA-GHORAHI-01' },
    allowedRoles: [Role.patient],
  },
];

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

  for (const testCase of cases) {
    describe(testCase.name, () => {
      for (const role of ALL_ROLES) {
        const shouldAllow = testCase.allowedRoles.includes(role);

        it(`role=${role} -> ${shouldAllow ? 'allowed (not 403)' : '403 FORBIDDEN'}`, async () => {
          const client = await asUser(app, role);
          const res =
            testCase.method === 'GET'
              ? await client.get(testCase.path)
              : await client.post(testCase.path, testCase.body);

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
