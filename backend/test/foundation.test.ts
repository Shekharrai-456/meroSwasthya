import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import { testClient } from './helpers/client.js';

describe('foundation', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();

    // Test-only routes to exercise the global error handler's shapes
    // (REQ-API-001..003) without depending on any real business module.
    app.get('/__test/validation-error', () => {
      z.object({ email: z.string().email() }).parse({ email: 'not-an-email' });
    });
    app.get('/__test/boom', () => {
      throw new Error('deliberate unhandled error for test coverage');
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('health endpoints', () => {
    it('GET /health/live returns 200 without touching the database', async () => {
      const res = await testClient(app).get('/health/live');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    });

    it('GET /health/ready reports database status (requires a reachable Postgres)', async () => {
      const res = await testClient(app).get('/health/ready');
      // Environment-dependent: 200 if Postgres is reachable at DATABASE_URL,
      // 503 with {status:"unavailable"} otherwise - both are "correct"
      // responses from this endpoint, so we assert the shape, not one status.
      expect([200, 503]).toContain(res.statusCode);
      expect(res.json()).toHaveProperty('status');
    });
  });

  describe('error envelope shape', () => {
    it('404 on an unknown route matches the envelope', async () => {
      const res = await testClient(app).get('/no-such-route');
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(typeof body.error.requestId).toBe('string');
    });

    it('422-shaped validation failure returns VALIDATION_ERROR with field details', async () => {
      const res = await testClient(app).get('/__test/validation-error');
      const body = res.json();
      expect(res.statusCode).toBe(400);
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(body.error.details)).toBe(true);
      expect(body.error.details[0]).toHaveProperty('field');
      expect(body.error.details[0]).toHaveProperty('message');
    });

    it('500 on an unhandled error never leaks the internal message', async () => {
      const res = await testClient(app).get('/__test/boom');
      const body = res.json();
      expect(res.statusCode).toBe(500);
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('INTERNAL');
      expect(body.error.message).not.toContain('deliberate unhandled error');
    });
  });

  describe('request id propagation', () => {
    it('every response carries an x-request-id header matching the error body (when present)', async () => {
      const res = await testClient(app).get('/__test/boom');
      const headerId = res.headers['x-request-id'];
      expect(typeof headerId).toBe('string');
      expect(res.json().error.requestId).toBe(headerId);
    });

    it('two different requests get two different request ids', async () => {
      const a = await testClient(app).get('/health/live');
      const b = await testClient(app).get('/health/live');
      expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
    });
  });
});

describe('config validation', () => {
  it('rejects a config missing required secrets, with a field-level message', () => {
    const result = parseConfig({
      DATABASE_URL: 'postgresql://x/y',
      TEST_DATABASE_URL: 'postgresql://x/y_test',
      REDIS_URL: 'redis://localhost:6379',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET: 'bucket',
      S3_ACCESS_KEY: 'x',
      S3_SECRET_KEY: 'y',
      // JWT_SECRET / GRANT_SECRET deliberately omitted
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.startsWith('JWT_SECRET'))).toBe(true);
      expect(result.issues.some((i) => i.startsWith('GRANT_SECRET'))).toBe(true);
    }
  });

  it('accepts a fully-specified valid config', () => {
    const result = parseConfig({
      DATABASE_URL: 'postgresql://x/y',
      TEST_DATABASE_URL: 'postgresql://x/y_test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'a'.repeat(32),
      GRANT_SECRET: 'b'.repeat(32),
      S3_ENDPOINT: 'http://localhost:9000',
      S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET: 'bucket',
      S3_ACCESS_KEY: 'x',
      S3_SECRET_KEY: 'y',
    });
    expect(result.success).toBe(true);
  });

  // Session 6 security audit finding (docs/SECURITY.md row 4): a grant token
  // must never be usable as a bearer access token, even if someone
  // accidentally configures the same value for both secrets.
  it('rejects JWT_SECRET and GRANT_SECRET being equal', () => {
    const sameSecret = 'a'.repeat(32);
    const result = parseConfig({
      DATABASE_URL: 'postgresql://x/y',
      TEST_DATABASE_URL: 'postgresql://x/y_test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: sameSecret,
      GRANT_SECRET: sameSecret,
      S3_ENDPOINT: 'http://localhost:9000',
      S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET: 'bucket',
      S3_ACCESS_KEY: 'x',
      S3_SECRET_KEY: 'y',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.startsWith('GRANT_SECRET'))).toBe(true);
    }
  });
});
