import { z } from 'zod';

export const codelistsQuerySchema = z.object({ kind: z.string().optional() });
export type CodelistsQuery = z.infer<typeof codelistsQuerySchema>;
