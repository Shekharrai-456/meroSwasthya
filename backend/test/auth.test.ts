import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '../generated/prisma/enums.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { prisma } from '../src/lib/prisma.js';
import { redis } from '../src/lib/redis.js';
import { asUser, testClient } from './helpers/client.js';
import { resetDb, resetRedis } from './helpers/db.js';

// REQ-AUTH-*, REQ-ROLE-*, REQ-USER-*, docs/SECURITY.md rows 1-5. Every test
// here exercises a real Postgres + real Redis through the real HTTP surface
// (.inject()) - nothing about auth is mocked (CLAUDE.md §10).

const JWT_SECRET = new TextEncoder().encode(config.JWT_SECRET);

async function signRawToken(
  payload: Record<string, unknown>,
  expSecondsFromNow: number,
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub as string)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expSecondsFromNow)
    .sign(JWT_SECRET);
}

function assertNoSecretLeak(body: unknown): void {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/pinHash/i);
  expect(text).not.toMatch(/\$argon2/);
}

describe('auth module', () => {
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

  describe('POST /api/v1/auth/otp/request (REQ-AUTH-002/003)', () => {
    it('returns otpSentTo, expiresInSec, and demoOtp when OTP_MODE=demo', async () => {
      const res = await testClient(app).post('/api/v1/auth/otp/request', {
        phone: '+9779801000001',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.data.otpSentTo).toBe('+9779801000001');
      expect(body.data.expiresInSec).toBe(300);
      expect(body.data.demoOtp).toBe('123456');
    });

    it('400 VALIDATION_ERROR on a non-E.164 phone', async () => {
      const res = await testClient(app).post('/api/v1/auth/otp/request', { phone: '98010000001' });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details[0].field).toBe('phone');
    });

    it('429 RATE_LIMITED on the 6th request within 10 minutes for the same phone', async () => {
      const phone = '+9779801000099';
      for (let i = 0; i < 5; i++) {
        const res = await testClient(app).post('/api/v1/auth/otp/request', { phone });
        expect(res.statusCode).toBe(200);
      }
      const res = await testClient(app).post('/api/v1/auth/otp/request', { phone });
      expect(res.statusCode).toBe(429);
      expect(res.json().error.code).toBe('RATE_LIMITED');
    });
  });

  describe('POST /api/v1/auth/otp/verify (REQ-AUTH-004)', () => {
    it('issues a tempToken and reports isNewUser=true, hasPin=false for a brand-new phone', async () => {
      const phone = '+9779801000002';
      await testClient(app).post('/api/v1/auth/otp/request', { phone });
      const res = await testClient(app).post('/api/v1/auth/otp/verify', { phone, otp: '123456' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(typeof body.data.tempToken).toBe('string');
      expect(body.data.hasPin).toBe(false);
      expect(body.data.isNewUser).toBe(true);
    });

    it('reports hasPin=true, isNewUser=false for an already-onboarded phone', async () => {
      const phone = '+9779801000003';
      await testClient(app).post('/api/v1/auth/otp/request', { phone });
      const first = await testClient(app).post('/api/v1/auth/otp/verify', { phone, otp: '123456' });
      await testClient(app).post(
        '/api/v1/auth/pin/set',
        { pin: '1234', name: 'Sita' },
        { Authorization: `Bearer ${first.json().data.tempToken}` },
      );

      await testClient(app).post('/api/v1/auth/otp/request', { phone });
      const res = await testClient(app).post('/api/v1/auth/otp/verify', { phone, otp: '123456' });
      expect(res.json().data.hasPin).toBe(true);
      expect(res.json().data.isNewUser).toBe(false);
    });

    it('400 on an unknown phone (no OTP ever requested)', async () => {
      const res = await testClient(app).post('/api/v1/auth/otp/verify', {
        phone: '+9779801099999',
        otp: '123456',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('400 on a wrong code, and increments attempts', async () => {
      const phone = '+9779801000004';
      await testClient(app).post('/api/v1/auth/otp/request', { phone });
      const res = await testClient(app).post('/api/v1/auth/otp/verify', { phone, otp: '000000' });
      expect(res.statusCode).toBe(400);
      const row = await prisma.otpCode.findUnique({ where: { phone } });
      expect(row?.attempts).toBe(1);
    });

    it('400 "too many attempts" after 5 wrong codes, even if the 6th call uses the correct code', async () => {
      const phone = '+9779801000005';
      await testClient(app).post('/api/v1/auth/otp/request', { phone });
      for (let i = 0; i < 5; i++) {
        await testClient(app).post('/api/v1/auth/otp/verify', { phone, otp: '000000' });
      }
      const res = await testClient(app).post('/api/v1/auth/otp/verify', { phone, otp: '123456' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.details[0].message).toMatch(/too many attempts/i);
    });

    it('400 on an expired code', async () => {
      const phone = '+9779801000006';
      await testClient(app).post('/api/v1/auth/otp/request', { phone });
      await prisma.otpCode.update({
        where: { phone },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await testClient(app).post('/api/v1/auth/otp/verify', { phone, otp: '123456' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.details[0].message).toMatch(/expired/i);
    });

    it('is single-use: verifying successfully twice with the same code fails the second time', async () => {
      const phone = '+9779801000007';
      await testClient(app).post('/api/v1/auth/otp/request', { phone });
      const first = await testClient(app).post('/api/v1/auth/otp/verify', { phone, otp: '123456' });
      expect(first.statusCode).toBe(200);
      const second = await testClient(app).post('/api/v1/auth/otp/verify', {
        phone,
        otp: '123456',
      });
      expect(second.statusCode).toBe(400);
    });

    it('400 VALIDATION_ERROR on a malformed otp shape', async () => {
      const res = await testClient(app).post('/api/v1/auth/otp/verify', {
        phone: '+9779801000008',
        otp: '12',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/auth/pin/set (REQ-AUTH-005, Q2 PIN reset)', () => {
    async function getTempToken(phone: string): Promise<string> {
      await testClient(app).post('/api/v1/auth/otp/request', { phone });
      const res = await testClient(app).post('/api/v1/auth/otp/verify', { phone, otp: '123456' });
      return res.json().data.tempToken;
    }

    it('401 with no Authorization header', async () => {
      const res = await testClient(app).post('/api/v1/auth/pin/set', { pin: '1234', name: 'X' });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });

    it('401 with a malformed token', async () => {
      const res = await testClient(app).post(
        '/api/v1/auth/pin/set',
        { pin: '1234', name: 'X' },
        { Authorization: 'Bearer not-a-jwt' },
      );
      expect(res.statusCode).toBe(401);
    });

    it('401 when presented an access token instead of a temp token (REQ-ROLE-008)', async () => {
      const client = await asUser(app, Role.patient);
      const res = await testClient(app).post(
        '/api/v1/auth/pin/set',
        { pin: '1234', name: 'X' },
        { Authorization: `Bearer ${client.accessToken}` },
      );
      expect(res.statusCode).toBe(401);
    });

    it('401 with an expired temp token', async () => {
      const expired = await signRawToken({ typ: 'temp', sub: '+9779801000009' }, -10);
      const res = await testClient(app).post(
        '/api/v1/auth/pin/set',
        { pin: '1234', name: 'X' },
        { Authorization: `Bearer ${expired}` },
      );
      expect(res.statusCode).toBe(401);
    });

    it('creates a new user, hashes the PIN with argon2id, and never returns pinHash', async () => {
      const phone = '+9779801000010';
      const tempToken = await getTempToken(phone);
      const res = await testClient(app).post(
        '/api/v1/auth/pin/set',
        { pin: '4321', name: 'Sita Chaudhary' },
        { Authorization: `Bearer ${tempToken}` },
      );
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(typeof body.data.accessToken).toBe('string');
      expect(typeof body.data.refreshToken).toBe('string');
      expect(body.data.user.phone).toBe(phone);
      expect(body.data.user.role).toBe('patient');
      assertNoSecretLeak(body);

      const row = await prisma.user.findUniqueOrThrow({ where: { phone } });
      expect(row.pinHash).toMatch(/^\$argon2id\$/);
    });

    it('overwrites pinHash on an existing user (PIN reset, Q2 Option A) - old PIN then fails', async () => {
      const phone = '+9779801000011';
      const tempToken1 = await getTempToken(phone);
      await testClient(app).post(
        '/api/v1/auth/pin/set',
        { pin: '1111', name: 'Sita' },
        { Authorization: `Bearer ${tempToken1}` },
      );

      const tempToken2 = await getTempToken(phone);
      await testClient(app).post(
        '/api/v1/auth/pin/set',
        { pin: '2222', name: 'Sita' },
        { Authorization: `Bearer ${tempToken2}` },
      );

      const oldPinLogin = await testClient(app).post('/api/v1/auth/pin/login', {
        phone,
        pin: '1111',
      });
      expect(oldPinLogin.statusCode).toBe(401);

      const newPinLogin = await testClient(app).post('/api/v1/auth/pin/login', {
        phone,
        pin: '2222',
      });
      expect(newPinLogin.statusCode).toBe(200);
    });

    it('400 VALIDATION_ERROR on a non-4-digit PIN', async () => {
      const tempToken = await getTempToken('+9779801000012');
      const res = await testClient(app).post(
        '/api/v1/auth/pin/set',
        { pin: '12', name: 'X' },
        { Authorization: `Bearer ${tempToken}` },
      );
      expect(res.statusCode).toBe(400);
    });

    it('400 VALIDATION_ERROR on an empty name', async () => {
      const tempToken = await getTempToken('+9779801000013');
      const res = await testClient(app).post(
        '/api/v1/auth/pin/set',
        { pin: '1234', name: '' },
        { Authorization: `Bearer ${tempToken}` },
      );
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/v1/auth/pin/login (REQ-AUTH-006, docs/SECURITY.md row 2)', () => {
    const phone = '+9779801000020';

    async function onboard(): Promise<void> {
      await testClient(app).post('/api/v1/auth/otp/request', { phone });
      const verify = await testClient(app).post('/api/v1/auth/otp/verify', {
        phone,
        otp: '123456',
      });
      await testClient(app).post(
        '/api/v1/auth/pin/set',
        { pin: '5555', name: 'Login Test' },
        { Authorization: `Bearer ${verify.json().data.tempToken}` },
      );
    }

    beforeEach(onboard);

    it('success: correct phone+pin returns tokens and user, never pinHash', async () => {
      const res = await testClient(app).post('/api/v1/auth/pin/login', { phone, pin: '5555' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(typeof body.data.accessToken).toBe('string');
      expect(body.data.user.phone).toBe(phone);
      assertNoSecretLeak(body);
    });

    it('401 UNAUTHENTICATED on a wrong PIN', async () => {
      const res = await testClient(app).post('/api/v1/auth/pin/login', { phone, pin: '0000' });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });

    it('401 with the same message shape for an unregistered phone (user-enumeration defense)', async () => {
      const res = await testClient(app).post('/api/v1/auth/pin/login', {
        phone: '+9779801099998',
        pin: '0000',
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });

    // Session 8 security-review finding: an unregistered phone used to
    // short-circuit before ever running argon2, returning far faster than a
    // wrong-PIN attempt on a real account - the identical error message alone
    // didn't close the user-enumeration side-channel, only its timing did.
    // Fixed by always running a real argon2 verify (against DUMMY_PIN_HASH
    // when there's no real user/pinHash) before responding either way.
    it('takes comparable time for an unregistered phone as for a wrong PIN on a real account (timing side-channel)', async () => {
      const time = async (body: Record<string, unknown>): Promise<number> => {
        const start = performance.now();
        await testClient(app).post('/api/v1/auth/pin/login', body);
        return performance.now() - start;
      };

      const wrongPinMs = await time({ phone, pin: '0000' });
      const unregisteredMs = await time({ phone: '+9779801099997', pin: '0000' });

      // A generous bound (not a tight timing assertion, which would be
      // flaky): before the fix, the unregistered-phone path skipped argon2
      // entirely and was over an order of magnitude faster. This only checks
      // that it now pays a comparable, real argon2 cost, not that the two
      // durations are near-identical.
      expect(unregisteredMs).toBeGreaterThan(wrongPinMs * 0.3);
    });

    it('locks the account for 15 min after 5 wrong PINs, independent of the request-rate limiter', async () => {
      for (let i = 0; i < 5; i++) {
        const res = await testClient(app).post('/api/v1/auth/pin/login', { phone, pin: '0000' });
        expect(res.statusCode).toBe(401);
      }
      // 6th attempt, even with the CORRECT pin, is blocked by the lockout.
      const res = await testClient(app).post('/api/v1/auth/pin/login', { phone, pin: '5555' });
      expect(res.statusCode).toBe(429);
      expect(res.json().error.code).toBe('RATE_LIMITED');

      // Two independent Redis keyspaces prove the two controls are separate
      // mechanisms (docs/SECURITY.md row 2), not the same counter read twice.
      const lockoutCount = await redis.get(`pin-lockout:${phone}`);
      expect(Number(lockoutCount)).toBeGreaterThanOrEqual(5);
    });

    it('429 RATE_LIMITED on the 11th login request within 15 min from one IP+phone (even all-correct PINs)', async () => {
      for (let i = 0; i < 10; i++) {
        const res = await testClient(app).post('/api/v1/auth/pin/login', { phone, pin: '5555' });
        expect(res.statusCode).toBe(200);
      }
      const res = await testClient(app).post('/api/v1/auth/pin/login', { phone, pin: '5555' });
      expect(res.statusCode).toBe(429);
    });

    it('400 VALIDATION_ERROR on a malformed body', async () => {
      const res = await testClient(app).post('/api/v1/auth/pin/login', { phone, pin: 'abcd' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/v1/auth/refresh (REQ-AUTH-007/011, docs/SECURITY.md row 5)', () => {
    async function onboardAndLogin(
      phone: string,
    ): Promise<{ accessToken: string; refreshToken: string }> {
      await testClient(app).post('/api/v1/auth/otp/request', { phone });
      const verify = await testClient(app).post('/api/v1/auth/otp/verify', {
        phone,
        otp: '123456',
      });
      const res = await testClient(app).post(
        '/api/v1/auth/pin/set',
        { pin: '7777', name: 'Refresh Test' },
        { Authorization: `Bearer ${verify.json().data.tempToken}` },
      );
      return res.json().data;
    }

    it('rotates the pair and revokes the old refresh token', async () => {
      const { refreshToken } = await onboardAndLogin('+9779801000030');
      const res = await testClient(app).post('/api/v1/auth/refresh', { refreshToken });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(typeof body.data.accessToken).toBe('string');
      expect(body.data.refreshToken).not.toBe(refreshToken);

      const reuse = await testClient(app).post('/api/v1/auth/refresh', { refreshToken });
      expect(reuse.statusCode).toBe(401);
    });

    it('reuse of an already-rotated token revokes the entire family, including a still-valid sibling token', async () => {
      const phone = '+9779801000031';
      const first = await onboardAndLogin(phone);
      // A second "session" for the same user (e.g. a different device) - its
      // own refresh token, still active.
      const secondLoginRes = await testClient(app).post('/api/v1/auth/pin/login', {
        phone,
        pin: '7777',
      });
      const secondRefreshToken = secondLoginRes.json().data.refreshToken;

      const rotateRes = await testClient(app).post('/api/v1/auth/refresh', {
        refreshToken: first.refreshToken,
      });
      expect(rotateRes.statusCode).toBe(200);

      // Replay the now-revoked original token.
      const replay = await testClient(app).post('/api/v1/auth/refresh', {
        refreshToken: first.refreshToken,
      });
      expect(replay.statusCode).toBe(401);

      // The sibling token from the second login must now be revoked too.
      const siblingReuse = await testClient(app).post('/api/v1/auth/refresh', {
        refreshToken: secondRefreshToken,
      });
      expect(siblingReuse.statusCode).toBe(401);
    });

    it('401 on an unknown/garbage refresh token', async () => {
      const res = await testClient(app).post('/api/v1/auth/refresh', {
        refreshToken: 'not-a-real-token',
      });
      expect(res.statusCode).toBe(401);
    });

    it('401 on an expired refresh token', async () => {
      const { refreshToken } = await onboardAndLogin('+9779801000032');
      const hash = (await import('../src/lib/hash.js')).hashRefreshToken(refreshToken);
      await prisma.refreshToken.update({
        where: { tokenHash: hash },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await testClient(app).post('/api/v1/auth/refresh', { refreshToken });
      expect(res.statusCode).toBe(401);
    });

    it('400 VALIDATION_ERROR on a missing refreshToken field', async () => {
      const res = await testClient(app).post('/api/v1/auth/refresh', {});
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/v1/auth/provider/activate (REQ-AUTH-008/013)', () => {
    beforeEach(async () => {
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

    it('401 with no Authorization header', async () => {
      const res = await testClient(app).post('/api/v1/auth/provider/activate', {
        inviteCode: 'HA-GHORAHI-01',
      });
      expect(res.statusCode).toBe(401);
    });

    it('403 FORBIDDEN when the caller is not role=patient', async () => {
      const client = await asUser(app, Role.provider);
      const res = await client.post('/api/v1/auth/provider/activate', {
        inviteCode: 'HA-GHORAHI-01',
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    });

    it('404 NOT_FOUND on an unknown invite code', async () => {
      const client = await asUser(app, Role.patient);
      const res = await client.post('/api/v1/auth/provider/activate', {
        inviteCode: 'NO-SUCH-CODE',
      });
      expect(res.statusCode).toBe(404);
    });

    it('activates the role and facility, and the invite code stays reusable for a second user', async () => {
      const clientA = await asUser(app, Role.patient);
      const resA = await clientA.post('/api/v1/auth/provider/activate', {
        inviteCode: 'HA-GHORAHI-01',
      });
      expect(resA.statusCode).toBe(200);
      expect(resA.json().data.user.role).toBe('provider');
      expect(resA.json().data.user.facilityId).toBe('f_0001');
      expect(resA.json().data.user.facilityName).toBe('Ghorahi Health Post');

      const clientB = await asUser(app, Role.patient);
      const resB = await clientB.post('/api/v1/auth/provider/activate', {
        inviteCode: 'HA-GHORAHI-01',
      });
      expect(resB.statusCode).toBe(200);
      expect(resB.json().data.user.role).toBe('provider');
    });
  });

  describe('GET /api/v1/me (REQ-AUTH-009)', () => {
    it('401 with no token', async () => {
      const res = await testClient(app).get('/api/v1/me');
      expect(res.statusCode).toBe(401);
    });

    it('401 with a malformed token', async () => {
      const res = await testClient(app).get('/api/v1/me', { Authorization: 'Bearer garbage' });
      expect(res.statusCode).toBe(401);
    });

    it('401 with an expired access token', async () => {
      const expired = await signRawToken(
        { typ: 'access', sub: 'nonexistent', role: 'patient', fid: null },
        -10,
      );
      const res = await testClient(app).get('/api/v1/me', { Authorization: `Bearer ${expired}` });
      expect(res.statusCode).toBe(401);
    });

    it('401 when presented a temp token instead of an access token', async () => {
      const temp = await signRawToken({ typ: 'temp', sub: '+9779801000040' }, 600);
      const res = await testClient(app).get('/api/v1/me', { Authorization: `Bearer ${temp}` });
      expect(res.statusCode).toBe(401);
    });

    it("returns only the caller's own record, never another user's (object-level boundary)", async () => {
      const clientA = await asUser(app, Role.patient, { name: 'User A' });
      const clientB = await asUser(app, Role.patient, { name: 'User B' });

      const resA = await clientA.get('/api/v1/me');
      const resB = await clientB.get('/api/v1/me');

      expect(resA.json().data.user.id).toBe(clientA.user.id);
      expect(resA.json().data.user.id).not.toBe(clientB.user.id);
      expect(resB.json().data.user.id).toBe(clientB.user.id);
      assertNoSecretLeak(resA.json());
    });
  });

  describe('no PIN/OTP/token ever reaches a log line (REQ-SEC-004)', () => {
    it('logs from a full OTP+PIN login cycle never contain the plaintext PIN, OTP, or issued tokens', async () => {
      const lines: string[] = [];
      const logApp = await buildApp({ logStream: { write: (msg) => lines.push(msg) } });
      await logApp.ready();
      try {
        const client = testClient(logApp);
        const phone = '+9779801000050';
        await client.post('/api/v1/auth/otp/request', { phone });
        const verify = await client.post('/api/v1/auth/otp/verify', { phone, otp: '123456' });
        const setRes = await client.post(
          '/api/v1/auth/pin/set',
          { pin: '9876', name: 'Log Leak Test' },
          { Authorization: `Bearer ${verify.json().data.tempToken}` },
        );
        const { accessToken, refreshToken } = setRes.json().data;
        await client.post('/api/v1/auth/pin/login', { phone, pin: '9876' });

        const log = lines.join('\n');
        expect(log).not.toContain('9876'); // the PIN
        expect(log).not.toContain('123456'); // the OTP
        expect(log).not.toContain(accessToken);
        expect(log).not.toContain(refreshToken);
        expect(log).not.toMatch(/\$argon2/);
      } finally {
        await logApp.close();
      }
    });
  });
});
