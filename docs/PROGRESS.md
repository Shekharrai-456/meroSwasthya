# Progress Log

Append-only. Never rewrite a past entry — correct forward, in a new entry, if something turns out to be wrong.

## 2026-09-18 — Session 1 — Design

**Requirements:** all 179 REQ IDs from `docs/REQUIREMENTS.md` (design-level coverage only — no implementation this session, per the Session 1 brief)
**Created:** `docs/TECH_DECISIONS.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/API_CONTRACT.md`, `docs/SECURITY.md`, `docs/PROJECT_PLAN.md`, this entry in `docs/PROGRESS.md`
**Modified:** `docs/OPEN_QUESTIONS.md` (six questions resolved)
**Commands run:** none — no build system, no dependency manifest, and no source tree exist yet; `make check` has nothing to check against until Session 2 creates the skeleton
**Result:** N/A (design-only session; nothing executable to report a pass/fail on)
**Decisions:**
- All six Session 0 open questions resolved by taking each one's own `RECOMMEND` line, per CLAUDE.md §5 ("decide yourself... applying standard engineering practice") — none of the six required a hard stop (no credentials, no irreversible action, no unresolvable conflict). Recorded inline in `docs/OPEN_QUESTIONS.md` and threaded through `ARCHITECTURE.md`/`DATA_MODEL.md`/`API_CONTRACT.md`/`SECURITY.md`/`PROJECT_PLAN.md` wherever they affect a design choice.
- No repository layer: Prisma calls live in `service.ts`, not a separate `repository.ts`, per CLAUDE.md's own anti-over-engineering rule — no module in this project has query reuse across services that would justify the extra file.
- Two DB-level integrity guarantees added beyond `backend.md`'s literal schema: a partial unique index enforcing "one active pregnancy per patient" (race-safe, unlike an app-only check under `READ COMMITTED`), and a `CHECK (contact_no BETWEEN 1 AND 8)` constraint — both as hand-added raw SQL in the generated Prisma migration, since `schema.prisma`'s DSL can't express either directly.
- Two indexes added beyond `backend.md`'s literal schema: `RefreshToken(userId)` (needed for PIN-reset revocation) and `Reminder(patientId)` (needed by `GET /patients/:id/reminders`, which had no supporting index in the original spec).
- Soft-delete: the `deleted` column and its read-path filters are built everywhere (the sync-pull contract requires the field to behave correctly), but no delete/archive endpoint exists — per Question 4.
- Document uploads: `image/png` is dropped from the accepted content types; only `image/jpeg` is accepted, so the object key's hard-coded `.jpg` extension is never wrong — per Question 3.
- Two additional security controls surfaced during threat-modeling that weren't explicit in `backend.md`: refresh-token reuse detection (revoke the whole family on a replayed, already-rotated token) and a rate limit on `/documents/presign`/`/documents/:id/complete` (closing Session 0's GAP G4). Both are now `docs/SECURITY.md` rows and have `docs/PROJECT_PLAN.md` rows.
**Blocked:** none of the design documents themselves are blocked. The six Question resolutions are marked "pending user confirmation" in `docs/OPEN_QUESTIONS.md` — if the user overrides any of them, `ARCHITECTURE.md`/`DATA_MODEL.md`/`API_CONTRACT.md`/`SECURITY.md`/`PROJECT_PLAN.md` need a corresponding, targeted revision before Session 2 starts building against them.
**Next task:** await user approval (CLAUDE.md Session 1 brief: "Do not start Session 2 until I approve"). Once approved, Session 2 — Foundation & test harness: project skeleton, `package.json` with pinned versions from `docs/TECH_DECISIONS.md`, Makefile targets, `docker-compose.yml`, Prisma init + baseline migration (including the two hand-added raw-SQL constraints from `docs/DATA_MODEL.md`), error-envelope + auth + rate-limit plugins, health endpoints, and the pytest-equivalent (`vitest`) harness proving the foundation actually works.
