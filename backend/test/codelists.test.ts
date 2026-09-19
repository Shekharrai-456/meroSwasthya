import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { testClient } from './helpers/client.js';
import { resetDb, resetRedis } from './helpers/db.js';

// REQ-CODELIST-001. Real Postgres + Redis throughout (CLAUDE.md §10).

describe('codelists module', () => {
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
    await prisma.codeListItem.createMany({
      data: [
        { kind: 'complaint', code: 'CC_FEVER', labelEn: 'Fever', labelNp: 'ज्वरो' },
        { kind: 'diagnosis', code: 'E11', labelEn: 'Type 2 diabetes', labelNp: 'मधुमेह' },
        {
          kind: 'drug',
          code: 'PARACETAMOL_500',
          labelEn: 'Paracetamol 500 mg',
          labelNp: 'प्यारासिटामोल',
          meta: { strength: '500 mg', form: 'tablet' },
        },
      ],
    });
  });

  it('needs no authentication', async () => {
    const client = testClient(app);
    const res = await client.get('/api/v1/codelists');
    expect(res.statusCode).toBe(200);
  });

  it('returns all items with a version, cached for 1 hour', async () => {
    const client = testClient(app);
    const res = await client.get('/api/v1/codelists');
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(typeof body.version).toBe('string');
    expect(body.items).toHaveLength(3);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('filters by kind', async () => {
    const client = testClient(app);
    const res = await client.get('/api/v1/codelists?kind=drug');
    const items = res.json().data.items;
    expect(items).toHaveLength(1);
    expect(items[0].code).toBe('PARACETAMOL_500');
    expect(items[0].meta.strength).toBe('500 mg');
  });
});
