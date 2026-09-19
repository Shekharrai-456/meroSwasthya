import { z } from 'zod';

export const codeListItemDtoSchema = z.object({
  kind: z.string(),
  code: z.string(),
  labelEn: z.string(),
  labelNp: z.string(),
  meta: z.record(z.string(), z.unknown()).nullable(),
});

export const codelistsResponseSchema = z.object({
  version: z.string(),
  items: z.array(codeListItemDtoSchema),
});
