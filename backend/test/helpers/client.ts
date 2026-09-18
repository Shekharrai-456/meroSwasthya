import type { FastifyInstance, InjectOptions } from 'fastify';
import type { InjectPayload } from 'light-my-request';
import type { Role } from '../../generated/prisma/enums.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/tokens.js';

// Thin wrapper over Fastify's .inject() (docs/TECH_DECISIONS.md's testing
// section: .inject() is the primary way this project tests routes; supertest
// is reserved for the one boot/smoke test that needs a real socket).
export function testClient(app: FastifyInstance) {
  const request = (options: InjectOptions) => app.inject(options);
  return {
    get: (url: string, headers?: Record<string, string>) =>
      request({ method: 'GET', url, headers }),
    post: (url: string, payload?: InjectPayload, headers?: Record<string, string>) =>
      request({ method: 'POST', url, payload, headers }),
    patch: (url: string, payload?: InjectPayload, headers?: Record<string, string>) =>
      request({ method: 'PATCH', url, payload, headers }),
    put: (url: string, payload?: InjectPayload, headers?: Record<string, string>) =>
      request({ method: 'PUT', url, payload, headers }),
  };
}

export interface TestUserOverrides {
  phone?: string;
  name?: string;
  facilityId?: string | null;
}

let testPhoneCounter = 0;

// Deterministic, collision-free, E.164-shaped test phone numbers (never
// dialled - this only bypasses the auth flow's own phone validation for
// convenience, it doesn't need to be a plausible real number).
function nextTestPhone(): string {
  testPhoneCounter += 1;
  return `+97798${String(testPhoneCounter).padStart(8, '0')}`;
}

// Creates (or updates) a real User row and signs a real access token for it -
// bypasses the OTP/PIN flow for speed, since what later modules' tests need
// is "a valid token for a user of role X", not to re-prove login itself
// (that's test/auth.test.ts's job). Every later module's tests can write
// `const client = await asUser(app, Role.provider)` instead of re-deriving a
// token by hand.
export async function asUser(app: FastifyInstance, role: Role, overrides: TestUserOverrides = {}) {
  const phone = overrides.phone ?? nextTestPhone();
  const user = await prisma.user.upsert({
    where: { phone },
    create: {
      phone,
      role,
      name: overrides.name ?? `Test ${role}`,
      facilityId: overrides.facilityId ?? null,
    },
    update: { role, facilityId: overrides.facilityId ?? null },
    include: { facility: true },
  });
  const accessToken = await signAccessToken(user);
  const base = testClient(app);
  const authHeaders = (headers?: Record<string, string>) => ({
    ...headers,
    Authorization: `Bearer ${accessToken}`,
  });
  return {
    user,
    accessToken,
    get: (url: string, headers?: Record<string, string>) => base.get(url, authHeaders(headers)),
    post: (url: string, payload?: InjectPayload, headers?: Record<string, string>) =>
      base.post(url, payload, authHeaders(headers)),
    patch: (url: string, payload?: InjectPayload, headers?: Record<string, string>) =>
      base.patch(url, payload, authHeaders(headers)),
    put: (url: string, payload?: InjectPayload, headers?: Record<string, string>) =>
      base.put(url, payload, authHeaders(headers)),
  };
}
