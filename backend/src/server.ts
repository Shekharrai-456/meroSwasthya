import { buildApp } from './app.js';
import { config } from './config.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { startWorkers } from './workers.js';

async function main(): Promise<void> {
  const app = await buildApp();
  // backend.md's directory tree: "same process in hackathon" - BullMQ
  // workers run alongside the HTTP server rather than as a separate deploy.
  const workers = startWorkers();

  const closeGracefully = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    // Session 6 production-readiness audit: app.close() waits for in-flight
    // requests to finish, which is correct - but with no upper bound, a
    // request handler that never resolves would hang the shutdown forever
    // instead of the orchestrator's next SIGKILL doing a hard, unclean stop.
    // This forces an exit after a bounded grace period either way.
    const forceExitTimer = setTimeout(() => {
      app.log.error({ signal }, 'graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000);
    forceExitTimer.unref();

    await app.close();
    await workers.close();
    await prisma.$disconnect();
    redis.disconnect();
    clearTimeout(forceExitTimer);
    process.exit(0);
  };
  process.on('SIGINT', () => void closeGracefully('SIGINT'));
  process.on('SIGTERM', () => void closeGracefully('SIGTERM'));

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: no logger instance survives a boot failure this early
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
