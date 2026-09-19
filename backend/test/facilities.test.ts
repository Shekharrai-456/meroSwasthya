import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '../generated/prisma/enums.js';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { asUser, testClient } from './helpers/client.js';
import { resetDb, resetRedis } from './helpers/db.js';

// REQ-FACILITY-001. Real Postgres + Redis throughout (CLAUDE.md §10).

describe('facilities module', () => {
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
    await prisma.facility.createMany({
      data: [
        {
          id: 'f_near',
          name: 'Ghorahi Health Post',
          type: 'health_post',
          hasBirthingCentre: false,
          lat: 28.03,
          lng: 82.48,
          municipality: 'Ghorahi',
        },
        {
          id: 'f_mid',
          name: 'Ward 5 Birthing Centre',
          type: 'birthing_centre',
          hasBirthingCentre: true,
          lat: 28.04,
          lng: 82.49,
          municipality: 'Ghorahi',
        },
        {
          id: 'f_far',
          name: 'Rapti Provincial Hospital',
          type: 'hospital',
          hasBirthingCentre: true,
          lat: 29.5,
          lng: 84.0,
          municipality: 'Tulsipur',
        },
      ],
    });
  });

  it('requires authentication', async () => {
    const client = testClient(app);
    const res = await client.get('/api/v1/facilities/nearby?lat=28.03&lng=82.48');
    expect(res.statusCode).toBe(401);
  });

  it('returns facilities sorted by distance from the given point', async () => {
    const user = await asUser(app, Role.provider);
    const res = await user.get('/api/v1/facilities/nearby?lat=28.03&lng=82.48');
    expect(res.statusCode).toBe(200);
    const items = res.json().data.items;
    expect(items.map((f: { id: string }) => f.id)).toEqual(['f_near', 'f_mid', 'f_far']);
    expect(items[0].distanceKm).toBeLessThan(items[1].distanceKm);
  });

  it('filters to birthing-centre facilities only when birthing=true', async () => {
    const user = await asUser(app, Role.provider);
    const res = await user.get('/api/v1/facilities/nearby?lat=28.03&lng=82.48&birthing=true');
    expect(res.statusCode).toBe(200);
    const items = res.json().data.items;
    expect(items.every((f: { hasBirthingCentre: boolean }) => f.hasBirthingCentre)).toBe(true);
    expect(items.map((f: { id: string }) => f.id)).toEqual(['f_mid', 'f_far']);
  });

  it('caps results at the requested limit', async () => {
    const user = await asUser(app, Role.provider);
    const res = await user.get('/api/v1/facilities/nearby?lat=28.03&lng=82.48&limit=1');
    expect(res.json().data.items).toHaveLength(1);
  });
});
