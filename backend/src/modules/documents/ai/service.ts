import { prisma } from '../../../lib/prisma.js';
import { type DocumentStorage, s3Storage } from '../storage.js';
import { type VisionSummaryClient, type VisionSummaryResult, anthropicClient } from './client.js';

const AI_DRAFT_FOOTER = 'AI draft — verify';

function formatAiSummary(result: VisionSummaryResult): string {
  const medicinesLine =
    result.medicines.length > 0
      ? `Medicines: ${result.medicines.join(', ')}`
      : 'Medicines: none identified';
  return [result.summaryNp, result.summaryEn, medicinesLine, AI_DRAFT_FOOTER].join('\n\n');
}

// REQ-DOC-007: downloads the object, calls the vision LLM, stores a
// Nepali+English summary with a medicines list and the "AI draft - verify"
// footer; status becomes done/failed. A single attempt, no retry counter -
// unlike Reminders (REQ-REMIND-003's explicit "retry up to 3 times"),
// backend.md's wording for this job is just "done/failed", and the REST
// endpoint lets a caller re-trigger `POST /documents/:id/summarize` freely
// to retry by hand.
//
// `document` not existing any more (deleted between enqueue and processing)
// is treated as a no-op, not an error - there is nothing left to update.
export async function processAiSummaryJob(
  documentId: string,
  storage: DocumentStorage = s3Storage,
  client: VisionSummaryClient = anthropicClient,
): Promise<void> {
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document) {
    return;
  }

  try {
    const { buffer } = await storage.downloadObject(document.objectKey);
    const result = await client.summarize(buffer.toString('base64'), document.contentType);
    await prisma.document.update({
      where: { id: documentId },
      data: { aiSummary: formatAiSummary(result), aiSummaryStatus: 'done' },
    });
  } catch {
    await prisma.document.update({
      where: { id: documentId },
      data: { aiSummaryStatus: 'failed' },
    });
  }
}
