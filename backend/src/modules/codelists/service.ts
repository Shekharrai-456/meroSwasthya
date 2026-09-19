import { prisma } from '../../lib/prisma.js';
import { type CodeListItemDto, toCodeListItemDto } from '../../lib/serializers.js';

// REQ-CODELIST-001. A fixed version tag, same convention as rules.json's
// "version" field (backend.md A.4's own example) - bumped by hand if the
// seeded content ever changes shape, since there's no per-row versioning.
export const CODELIST_VERSION = '2026-09-18.1';

export async function listCodelistItems(kind?: string): Promise<CodeListItemDto[]> {
  const items = await prisma.codeListItem.findMany({
    where: kind ? { kind } : undefined,
    orderBy: [{ kind: 'asc' }, { code: 'asc' }],
  });
  return items.map(toCodeListItemDto);
}
