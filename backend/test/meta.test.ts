import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
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

  describe('GET /api/v1/demo/sms and /demo/sms.html (REQ-REMIND-006, SMS_MODE=mock)', () => {
    it('needs no authentication and returns the last 50 mock SMS, newest first', async () => {
      // Explicit, distinct sentAt values - createMany runs as one INSERT
      // inside one transaction, so Postgres's now() would otherwise give
      // every row the identical default timestamp, making DESC order
      // ambiguous.
      await prisma.mockSms.createMany({
        data: [
          { to: '+9779801000001', text: 'first', sentAt: new Date(Date.now() - 1000) },
          { to: '+9779801000002', text: 'second', sentAt: new Date() },
        ],
      });
      const client = testClient(app);
      const res = await client.get('/api/v1/demo/sms');
      expect(res.statusCode).toBe(200);
      const items = res.json().data.items;
      expect(items).toHaveLength(2);
      expect(items[0].text).toBe('second');
    });

    it('serves an auto-refreshing HTML page', async () => {
      await prisma.mockSms.create({ data: { to: '+9779801000001', text: 'projector test' } });
      const client = testClient(app);
      const res = await client.get('/api/v1/demo/sms.html');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('http-equiv="refresh"');
      expect(res.body).toContain('projector test');
    });
  });
});
