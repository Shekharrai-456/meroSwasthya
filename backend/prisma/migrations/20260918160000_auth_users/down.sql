-- Manual rollback for this migration (Prisma has no native down-migration
-- runner; kept here per CLAUDE.md §9's "every migration has a working
-- downgrade()" and applied with `prisma db execute --file down.sql` if ever
-- needed). Drop order respects FK dependencies: children before parents,
-- enum types after every table that uses them is gone.
-- Applied for real against a live Postgres and re-verified in Session 3
-- (continued) - see docs/PROGRESS.md's Session 3 (continued) entry.

DROP TABLE IF EXISTS "invite_codes";
DROP TABLE IF EXISTS "refresh_tokens";
DROP TABLE IF EXISTS "otp_codes";
DROP TABLE IF EXISTS "users";
DROP TABLE IF EXISTS "facilities";
DROP TYPE IF EXISTS "Role";
DROP TYPE IF EXISTS "FacilityType";
