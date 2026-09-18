// CLAUDE.md §8: "Export docs/openapi.json whenever the API changes and note
// the change in docs/PROGRESS.md." Boots the real app (routes + their
// docs-only schema.body/response - see src/lib/routeDocs.ts), asks
// @fastify/swagger for the assembled document, writes it out, and exits -
// this never starts a listening server or touches the database.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { redis } from '../src/lib/redis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, '../../docs/openapi.json');

async function main(): Promise<void> {
  const app = await buildApp();
  await app.ready();
  const document = app.swagger();
  await writeFile(outPath, `${JSON.stringify(document, null, 2)}\n`, 'utf-8');
  // biome-ignore lint/suspicious/noConsole: one-shot CLI script, not app code
  console.log(`Wrote ${outPath}`);
  await app.close();
  await prisma.$disconnect();
  redis.disconnect();
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: one-shot CLI script, not app code
  console.error('Failed to export OpenAPI document:', err);
  process.exit(1);
});
