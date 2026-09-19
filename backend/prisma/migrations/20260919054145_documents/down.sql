-- Manual rollback for this migration (Prisma has no native down-migration
-- runner; kept here per CLAUDE.md §9's "every migration has a working
-- downgrade()", same pattern as prior migrations' down.sql).

DROP TABLE IF EXISTS "documents";
DROP TYPE IF EXISTS "AiStatus";
DROP TYPE IF EXISTS "DocStatus";
DROP TYPE IF EXISTS "DocType";
