-- Manual rollback for this migration (Prisma has no native down-migration
-- runner; kept here per CLAUDE.md §9's "every migration has a working
-- downgrade()", same pattern as the Session 3 migration's down.sql).
-- Drop order respects FK dependencies: children before parents.

DROP TABLE IF EXISTS "audit_entries";
DROP TABLE IF EXISTS "access_grants";
DROP TABLE IF EXISTS "patients";
DROP TYPE IF EXISTS "AuditAction";
DROP TYPE IF EXISTS "GrantScope";
DROP TYPE IF EXISTS "Sex";
