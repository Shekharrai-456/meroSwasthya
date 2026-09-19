import { config } from '../../config.js';
import { AppError, ErrorCode } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { type ReminderDto, toReminderDto } from '../../lib/serializers.js';
import type { SmsAdapter } from './sms/adapter.js';
import { mockSms } from './sms/mock.js';
import { sparrowSms } from './sms/sparrow.js';

export async function findPatientOrThrow(patientId: string) {
  const patient = await prisma.patient.findFirst({ where: { id: patientId, deleted: false } });
  if (!patient) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Patient not found');
  }
  return patient;
}

const MAX_ATTEMPTS = 3;
const POLL_LIMIT = 100;

export function getSmsAdapter(): SmsAdapter {
  return config.SMS_MODE === 'sparrow' ? sparrowSms : mockSms;
}

// REQ-REMIND-001/003: polls pending reminders whose dueAt has passed, sends
// each via the configured adapter, and retries a failure on the next tick
// (leaving status=pending) up to 3 total attempts before marking it
// permanently failed. A plain, directly-callable function - not a BullMQ job
// body - so it's testable with a fake SmsAdapter and no queue/worker
// infrastructure; `worker.ts`'s repeatable job is a thin wrapper around it.
export async function processPendingReminders(
  adapter: SmsAdapter = getSmsAdapter(),
): Promise<{ sent: number; failed: number }> {
  const due = await prisma.reminder.findMany({
    where: { status: 'pending', dueAt: { lte: new Date() } },
    take: POLL_LIMIT,
  });

  let sent = 0;
  let failed = 0;
  for (const reminder of due) {
    try {
      await adapter.send(reminder.recipientPhone, reminder.messageNp);
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: { status: 'sent', sentAt: new Date() },
      });
      sent += 1;
    } catch {
      const attempts = reminder.attempts + 1;
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: attempts >= MAX_ATTEMPTS ? { status: 'failed', attempts } : { attempts },
      });
      failed += 1;
    }
  }
  return { sent, failed };
}

// REQ-REMIND-005: canRead-gated (checked by the caller, routes.ts); upcoming
// pending reminders + the last 20 sent.
export async function listReminders(patientId: string): Promise<ReminderDto[]> {
  const [pending, sentReminders] = await Promise.all([
    prisma.reminder.findMany({
      where: { patientId, status: 'pending' },
      orderBy: { dueAt: 'asc' },
    }),
    prisma.reminder.findMany({
      where: { patientId, status: 'sent' },
      orderBy: { sentAt: 'desc' },
      take: 20,
    }),
  ]);
  return [...pending, ...sentReminders].map(toReminderDto);
}

// REQ-REMIND-007 (SMS_MODE=mock only, enforced by the caller): forces the
// next pending reminder for a patient to be due now, so a live demo doesn't
// have to wait for the real due time.
export async function fireNextReminder(patientId: string): Promise<ReminderDto | null> {
  const next = await prisma.reminder.findFirst({
    where: { patientId, status: 'pending' },
    orderBy: { dueAt: 'asc' },
  });
  if (!next) {
    return null;
  }
  const updated = await prisma.reminder.update({
    where: { id: next.id },
    data: { dueAt: new Date() },
  });
  return toReminderDto(updated);
}
