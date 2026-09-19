import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../../config.js';
import { processPendingReminders } from './service.js';

// REQ-REMIND-001: poll every 60s. Uses BullMQ v6's `upsertJobScheduler` API
// (verified against the installed package's own type declarations this
// session, not a possibly-stale tutorial - docs/TECH_DECISIONS.md's "Session
// 11 verification" entry) - the older `repeat` job option it replaced is not
// present in this version at all.
const QUEUE_NAME = 'reminders';
const JOB_NAME = 'poll';
const SCHEDULER_ID = 'reminders-poll';
const POLL_INTERVAL_MS = 60_000;

// BullMQ requires `maxRetriesPerRequest: null` on any connection used for
// its blocking commands - it throws at Worker construction time otherwise.
// `lib/redis.ts`'s shared client deliberately sets `maxRetriesPerRequest: 2`
// for the rate-limiter's fail-fast needs (REQ-AUTH-002/006), so BullMQ gets
// its own separate connection to the same REDIS_URL rather than reusing it.
function createBullMqConnection(): Redis {
  return new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
}

// Not started by default (no server.ts/workers.ts wiring calls this at
// import time) - src/workers.ts (the process entry point named in
// backend.md's directory tree) is what actually starts it when the real
// server runs. Tests call `processPendingReminders` directly instead of
// spinning up a real BullMQ worker/scheduler.
export function startRemindersWorker(): { queue: Queue; worker: Worker } {
  const queue = new Queue(QUEUE_NAME, { connection: createBullMqConnection() });
  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      await processPendingReminders();
    },
    { connection: createBullMqConnection() },
  );

  void queue.upsertJobScheduler(SCHEDULER_ID, { every: POLL_INTERVAL_MS }, { name: JOB_NAME });

  return { queue, worker };
}
