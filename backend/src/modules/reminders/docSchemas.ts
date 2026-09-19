import { z } from 'zod';

export const reminderDtoSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  pregnancyId: z.string().nullable(),
  kind: z.enum(['anc_due', 'anc_missed', 'follow_up', 'medicine']),
  dueAt: z.string(),
  channel: z.enum(['sms', 'push']),
  recipientPhone: z.string(),
  recipientRole: z.string(),
  messageNp: z.string(),
  messageEn: z.string(),
  status: z.enum(['pending', 'sent', 'failed', 'cancelled']),
  sentAt: z.string().nullable(),
});

export const reminderListResponseSchema = z.object({ items: z.array(reminderDtoSchema) });

export const demoFireResponseSchema = z.object({ reminder: reminderDtoSchema.nullable() });
