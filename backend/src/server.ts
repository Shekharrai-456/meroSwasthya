import { buildApp } from './app.js';
import { config } from './config.js';
import { prisma } from './lib/prisma.js';

async function main(): Promise<void> {
  const app = await buildApp();

  const closeGracefully = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await prisma.$disconnect();
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
