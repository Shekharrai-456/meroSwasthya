-- Manual rollback for this migration (Prisma has no native down-migration
-- runner; kept here per CLAUDE.md §9's "every migration has a working
-- downgrade()", same pattern as prior migrations' down.sql).
-- Drop order respects FK dependencies: children before parents.

DROP TABLE IF EXISTS "visits";
DROP TABLE IF EXISTS "reminders";
DROP TABLE IF EXISTS "codelist_items";
DROP TYPE IF EXISTS "ReminderStatus";
DROP TYPE IF EXISTS "Channel";
DROP TYPE IF EXISTS "ReminderKind";
