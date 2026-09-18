-- Manual rollback for this migration (Prisma has no native down-migration
-- runner; kept here per CLAUDE.md §9's "every migration has a working
-- downgrade()", same pattern as prior migrations' down.sql).

DROP INDEX IF EXISTS "access_grants_redeemed_by_user_id_revoked_at_access_until_idx";
