import { prisma } from '../../../lib/prisma.js';
import type { SmsAdapter } from './adapter.js';

// REQ-REMIND-002/006. Never fails - there is no real gateway to reject a
// message, only a row insert.
export const mockSms: SmsAdapter = {
  async send(to: string, text: string): Promise<void> {
    await prisma.mockSms.create({ data: { to, text } });
  },
};
