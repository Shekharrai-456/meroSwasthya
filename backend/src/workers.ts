import { startRemindersWorker } from './modules/reminders/worker.js';

// Named/located per backend.md's directory tree: "workers.ts // starts
// BullMQ workers (same process in hackathon)". Only the reminders worker
// exists so far; the ai-summary worker (Phase 9, Tier 2) will start here too
// once Documents exists.
export function startWorkers(): { close: () => Promise<void> } {
  const { queue, worker } = startRemindersWorker();
  return {
    close: async () => {
      await worker.close();
      await queue.close();
    },
  };
}
