-- Manual rollback for this migration (Prisma has no native down-migration
-- runner; kept here per CLAUDE.md §9's "every migration has a working
-- downgrade()", same pattern as prior migrations' down.sql).
-- Drop order respects FK dependencies: children before parents. The
-- reminders.pregnancy_id column (added by this migration, not a new table)
-- is dropped explicitly rather than the whole table.

ALTER TABLE "anc_contacts" DROP CONSTRAINT IF EXISTS "anc_contacts_contact_no_range";
DROP INDEX IF EXISTS "pregnancies_one_active_per_patient";
DROP TABLE IF EXISTS "deliveries";
DROP TABLE IF EXISTS "anc_contacts";
ALTER TABLE "reminders" DROP COLUMN IF EXISTS "pregnancy_id";
DROP TABLE IF EXISTS "pregnancies";
DROP TYPE IF EXISTS "Outcome";
DROP TYPE IF EXISTS "DeliveryMode";
DROP TYPE IF EXISTS "DeliveryPlace";
DROP TYPE IF EXISTS "Triage";
DROP TYPE IF EXISTS "RiskLevel";
DROP TYPE IF EXISTS "PregStatus";
