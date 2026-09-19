import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '../generated/prisma/enums.js';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { processPendingReminders } from '../src/modules/reminders/service.js';
import type { SmsAdapter } from '../src/modules/reminders/sms/adapter.js';
import { asUser, testClient } from './helpers/client.js';
import { resetDb, resetRedis } from './helpers/db.js';

// REQ-REMIND-001/003/005/007. Real Postgres + Redis throughout (CLAUDE.md
// §10). `processPendingReminders` is tested directly with a fake SmsAdapter -
// no BullMQ/worker infrastructure needed, since worker.ts is a thin wrapper
// around this same function (see its own comment).

function fakeAdapter(behavior: (to: string, text: string) => Promise<void>): SmsAdapter {
  return { send: behavior };
}

async function createPatientWithReminder(overrides: Record<string, unknown> = {}) {
  const patient = await prisma.patient.create({
    data: {
      id: randomUUID(),
      ownerUserId: (
        await prisma.user.create({
          data: {
            phone: `+97798${Math.floor(Math.random() * 1e8)}`,
            role: Role.patient,
            name: 'X',
          },
        })
      ).id,
      name: 'Test Patient',
      sex: 'female',
      dob: new Date('2000-01-01'),
    },
  });
  const reminder = await prisma.reminder.create({
    data: {
      patientId: patient.id,
      kind: 'follow_up',
      dueAt: new Date(Date.now() - 1000),
      recipientPhone: '+9779801000099',
      recipientRole: 'patient',
      messageNp: 'np text',
      messageEn: 'en text',
      ...overrides,
    },
  });
  return { patient, reminder };
}

describe('reminders module', () => {
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

  describe('processPendingReminders (REQ-REMIND-001/003)', () => {
    it('sends a due pending reminder and marks it sent', async () => {
      const { reminder } = await createPatientWithReminder();
      const sentTo: string[] = [];
      const result = await processPendingReminders(
        fakeAdapter(async (to) => {
          sentTo.push(to);
        }),
      );
      expect(result.sent).toBe(1);
      expect(sentTo).toEqual(['+9779801000099']);
      const updated = await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
      expect(updated.status).toBe('sent');
      expect(updated.sentAt).not.toBeNull();
    });

    it('ignores reminders not yet due', async () => {
      const { reminder } = await createPatientWithReminder({
        dueAt: new Date(Date.now() + 3_600_000),
      });
      const result = await processPendingReminders(fakeAdapter(async () => {}));
      expect(result.sent).toBe(0);
      const unchanged = await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
      expect(unchanged.status).toBe('pending');
    });

    it('leaves a failed send pending for retry until 3 attempts, then marks it failed', async () => {
      const { reminder } = await createPatientWithReminder();
      const failingAdapter = fakeAdapter(async () => {
        throw new Error('network down');
      });

      const first = await processPendingReminders(failingAdapter);
      expect(first.failed).toBe(1);
      let current = await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
      expect(current.status).toBe('pending');
      expect(current.attempts).toBe(1);

      await processPendingReminders(failingAdapter);
      current = await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
      expect(current.status).toBe('pending');
      expect(current.attempts).toBe(2);

      await processPendingReminders(failingAdapter);
      current = await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
      expect(current.status).toBe('failed');
      expect(current.attempts).toBe(3);
    });

    it('never touches already-sent or already-failed reminders', async () => {
      await createPatientWithReminder({ status: 'sent', sentAt: new Date() });
      await createPatientWithReminder({ status: 'failed', attempts: 3 });
      const result = await processPendingReminders(fakeAdapter(async () => {}));
      expect(result.sent).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe('GET /api/v1/patients/:id/reminders (REQ-REMIND-005)', () => {
    it('requires authentication', async () => {
      const client = testClient(app);
      const res = await client.get(`/api/v1/patients/${randomUUID()}/reminders`);
      expect(res.statusCode).toBe(401);
    });

    it('404s for a nonexistent patient', async () => {
      const owner = await asUser(app, Role.patient);
      const res = await owner.get(`/api/v1/patients/${randomUUID()}/reminders`);
      expect(res.statusCode).toBe(404);
    });

    it('403s for a user with no access', async () => {
      const { patient } = await createPatientWithReminder();
      const stranger = await asUser(app, Role.provider);
      const res = await stranger.get(`/api/v1/patients/${patient.id}/reminders`);
      expect(res.statusCode).toBe(403);
    });

    it('returns pending and sent reminders for the owner', async () => {
      const { patient, reminder } = await createPatientWithReminder();
      const owner = await asUser(app, Role.patient, {
        phone: (await prisma.user.findUniqueOrThrow({ where: { id: patient.ownerUserId } })).phone,
      });
      const res = await owner.get(`/api/v1/patients/${patient.id}/reminders`);
      expect(res.statusCode).toBe(200);
      const items = res.json().data.items;
      expect(items.some((r: { id: string }) => r.id === reminder.id)).toBe(true);
    });
  });

  describe('POST /api/v1/demo/reminders/fire (REQ-REMIND-007, SMS_MODE=mock)', () => {
    it('marks the next pending reminder as due now', async () => {
      const { patient, reminder } = await createPatientWithReminder({
        dueAt: new Date(Date.now() + 3_600_000),
      });
      const actor = await asUser(app, Role.provider);
      const res = await actor.post('/api/v1/demo/reminders/fire', { patientId: patient.id });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.reminder.id).toBe(reminder.id);
      const updated = await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
      expect(updated.dueAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('returns null when the patient has no pending reminder', async () => {
      const actor = await asUser(app, Role.provider);
      const res = await actor.post('/api/v1/demo/reminders/fire', { patientId: randomUUID() });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.reminder).toBeNull();
    });
  });
});
