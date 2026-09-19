import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../../../config.js';
import { processAiSummaryJob } from './service.js';

// REQ-DOC-007. Same architecture as reminders/worker.ts: a dedicated Redis
// connection per BullMQ client (it requires `maxRetriesPerRequest: null`,
// which the shared lib/redis.ts client deliberately doesn't set).
const QUEUE_NAME = 'ai-summary';
const JOB_NAME = 'summarize';

function createBullMqConnection(): Redis {
  return new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
}

// Lazily created and reused - `enqueueAiSummaryJob` (called from
// documents/service.ts on every `POST /documents/:id/summarize`) is a
// producer that must work whether or not a worker is running in this
// process; a fresh Queue per call would leak a connection per request.
let sharedQueue: Queue | null = null;
function getAiSummaryQueue(): Queue {
  if (!sharedQueue) {
    sharedQueue = new Queue(QUEUE_NAME, { connection: createBullMqConnection() });
  }
  return sharedQueue;
}

export async function enqueueAiSummaryJob(documentId: string): Promise<void> {
  await getAiSummaryQueue().add(JOB_NAME, { documentId });
}

// Started by src/workers.ts only when config.AI_MODE === 'on' (no point
// holding a BullMQ connection open for a feature that's off). Tests call
// `processAiSummaryJob` directly instead, same convention as
// reminders/worker.ts's own comment.
export function startAiSummaryWorker(): { queue: Queue; worker: Worker } {
  const queue = getAiSummaryQueue();
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      await processAiSummaryJob(job.data.documentId as string);
    },
    { connection: createBullMqConnection() },
  );
  return { queue, worker };
}
