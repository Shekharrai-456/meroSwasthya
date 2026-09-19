import { config } from './config.js';
import { startAiSummaryWorker } from './modules/documents/ai/worker.js';
import { startRemindersWorker } from './modules/reminders/worker.js';

// Named/located per backend.md's directory tree: "workers.ts // starts
// BullMQ workers (same process in hackathon)". The ai-summary worker only
// starts when AI_MODE=on - no point holding a BullMQ/Redis connection open
// for a feature that's off (and config.ts's own `.refine()` already
// guarantees ANTHROPIC_API_KEY is set whenever AI_MODE=on).
export function startWorkers(): { close: () => Promise<void> } {
  const handles = [startRemindersWorker()];
  if (config.AI_MODE === 'on') {
    handles.push(startAiSummaryWorker());
  }
  return {
    close: async () => {
      for (const { worker, queue } of handles) {
        await worker.close();
        await queue.close();
      }
    },
  };
}
