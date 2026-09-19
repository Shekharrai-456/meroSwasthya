import { config } from '../../../config.js';
import type { SmsAdapter } from './adapter.js';

// REQ-REMIND-002. Verified against Sparrow's own docs this session, not
// backend.md's paraphrase alone (docs/TECH_DECISIONS.md's "Sparrow SMS API
// shape" entry): GET/POST http://api.sparrowsms.com/v2/sms/ with
// token/from/to/text; success is `{ response_code: 200, ... }`, failure is
// HTTP 403 with a non-200 `response_code`. Never exercised against a real
// account in this build - SMS_MODE stays "mock" (no SPARROW_TOKEN configured
// in this environment).
const SPARROW_ENDPOINT = 'https://api.sparrowsms.com/v2/sms/';

interface SparrowResponse {
  response_code: number;
  response: string;
  count?: number;
}

export const sparrowSms: SmsAdapter = {
  async send(to: string, text: string): Promise<void> {
    if (!config.SPARROW_TOKEN || !config.SPARROW_FROM) {
      throw new Error('SPARROW_TOKEN/SPARROW_FROM are not configured');
    }
    const params = new URLSearchParams({
      token: config.SPARROW_TOKEN,
      from: config.SPARROW_FROM,
      to,
      text,
    });
    const response = await fetch(`${SPARROW_ENDPOINT}?${params.toString()}`, { method: 'POST' });
    const body = (await response.json()) as SparrowResponse;
    if (body.response_code !== 200) {
      throw new Error(`Sparrow SMS send failed: ${body.response_code} ${body.response}`);
    }
  },
};
