import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { testClient } from './helpers/client.js';
import { resetDb, resetRedis } from './helpers/db.js';

// REQ-META-001/002. Real Postgres + Redis throughout (CLAUDE.md §10), even
// though these two routes don't touch either directly - consistent with
// every other suite's setup.

describe('meta module', () => {
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

  describe('GET /api/v1/rules (REQ-META-001)', () => {
    it('needs no authentication and serves the RULES table verbatim', async () => {
      const client = testClient(app);
      const res = await client.get('/api/v1/rules');
      expect(res.statusCode).toBe(200);
      const rules = res.json().data;
      expect(typeof rules.version).toBe('string');
      expect(rules.ancSchedule).toHaveLength(8);
      expect(rules.dangerSigns.length).toBeGreaterThan(0);
      expect(rules.riskFactors.length).toBeGreaterThan(0);
      expect(rules.triage.description).toContain('red > amber > green');
    });
  });

  describe('GET /api/v1/config (REQ-META-002)', () => {
    it('needs no authentication and exposes feature flags matching env defaults', async () => {
      const client = testClient(app);
      const res = await client.get('/api/v1/config');
      expect(res.statusCode).toBe(200);
      const body = res.json().data;
      expect(body.smsMode).toBe('mock');
      expect(body.otpDemo).toBe(true);
      expect(body.aiSummaryEnabled).toBe(false);
      expect(typeof body.rulesVersion).toBe('string');
      expect(typeof body.codelistVersion).toBe('string');
    });
  });
});
