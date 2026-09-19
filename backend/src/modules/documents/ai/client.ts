import { config } from '../../../config.js';

// REQ-DOC-007. Raw `fetch()` against Anthropic's Messages API, not the
// `@anthropic-ai/sdk` package - the same "no convenience wrapper around
// something a plain HTTP POST already does" decision as the SparrowSms
// adapter (reminders/sms/sparrow.ts). Request/response shapes verified
// against https://platform.claude.com/docs/en/api/messages (fetched
// 2026-09-19) - see docs/TECH_DECISIONS.md.
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 1024;

export interface VisionSummaryResult {
  summaryEn: string;
  summaryNp: string;
  medicines: string[];
}

export interface VisionSummaryClient {
  summarize(imageBase64: string, contentType: string): Promise<VisionSummaryResult>;
}

const PROMPT = `You are looking at a photo of a medical document (prescription, lab report, discharge summary, or referral) from a rural Nepali health post. Respond with ONLY a JSON object, no other text and no markdown code fences, matching exactly this shape:
{"summaryEn": "a 2-4 sentence plain-English summary of the document's key findings and instructions", "summaryNp": "the same summary translated into Nepali (Devanagari script)", "medicines": ["drug name and dose exactly as written, one per array entry"]}
If the image is unreadable or is not a medical document, set summaryEn and summaryNp to a short message saying so, and set medicines to an empty array.`;

// Claude sometimes wraps JSON output in a \`\`\`json ... \`\`\` fence despite
// being told not to - stripped defensively rather than trusting the prompt
// alone to be followed every time.
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicMessageResponse {
  content: AnthropicContentBlock[];
}

export const anthropicClient: VisionSummaryClient = {
  async summarize(imageBase64, contentType) {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': config.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              {
                type: 'image',
                source: { type: 'base64', media_type: contentType, data: imageBase64 },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${await response.text()}`);
    }

    const body = (await response.json()) as AnthropicMessageResponse;
    const textBlock = body.content.find((block) => block.type === 'text');
    if (!textBlock?.text) {
      throw new Error('Anthropic response had no text content block');
    }

    const parsed = JSON.parse(stripCodeFence(textBlock.text)) as Partial<VisionSummaryResult>;
    if (
      typeof parsed.summaryEn !== 'string' ||
      typeof parsed.summaryNp !== 'string' ||
      !Array.isArray(parsed.medicines)
    ) {
      throw new Error('Anthropic response JSON did not match the expected shape');
    }
    return {
      summaryEn: parsed.summaryEn,
      summaryNp: parsed.summaryNp,
      medicines: parsed.medicines,
    };
  },
};
