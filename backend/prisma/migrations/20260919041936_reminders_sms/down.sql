-- Manual rollback for this migration (Prisma has no native down-migration
-- runner; kept here per CLAUDE.md §9's "every migration has a working
-- downgrade()", same pattern as prior migrations' down.sql).

DROP INDEX IF EXISTS "reminders_status_due_at_idx";
DROP TABLE IF EXISTS "mock_sms";
ALTER TABLE "reminders" DROP COLUMN IF EXISTS "attempts";
