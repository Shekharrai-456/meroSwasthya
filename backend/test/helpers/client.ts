import type { FastifyInstance, InjectOptions } from 'fastify';
import type { InjectPayload } from 'light-my-request';

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

// PLACEHOLDER (Session 2 scope - no auth exists yet). Once Session 3 builds
// real login, this returns a client whose requests carry a valid
// `Authorization: Bearer <accessToken>` for the given role/user, so every
// later module's tests can write `const client = await asUser(app, 'provider')`
// instead of re-deriving a token by hand. Calling it today is a deliberate
// build-time error, not a silent stub, so nothing can accidentally rely on
// authentication that doesn't exist yet.
export function asUser(): never {
  throw new Error(
    'asUser() is not implemented until Session 3 builds real authentication - see test/helpers/client.ts',
  );
}
