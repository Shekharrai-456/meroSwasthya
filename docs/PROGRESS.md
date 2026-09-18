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

## 2026-09-18 — Session 2 — Foundation

**Requirements:** REQ-API-001..004 (VERIFIED/IMPLEMENTED), REQ-API-005/006/007 (still NOT_STARTED — no models/entities exist yet), REQ-API-008 (IMPLEMENTED), REQ-SEC-001/002/003/004 (IMPLEMENTED/VERIFIED, see `docs/PROJECT_PLAN.md` Phase 0 for the per-row breakdown)
**Created:** `backend/` skeleton — `package.json`, `tsconfig.json`, `biome.json`, `docker-compose.yml`, `Makefile`, `README.md`, `.env.example`, `.github/workflows/ci.yml`, `prisma/schema.prisma` (empty, generator+datasource only), `prisma.config.ts`, one empty baseline migration, `prisma/seed.ts` (no-op placeholder), `src/config.ts`, `src/app.ts`, `src/server.ts`, `src/health.ts`, `src/lib/{errors,dates,prisma}.ts`, `src/plugins/{envelope,ratelimit}.ts`, `test/{setup,foundation.test}.ts`, `test/helpers/client.ts`
**Modified:** `docs/TECH_DECISIONS.md` (two corrections found during install — see Decisions), `docs/PROJECT_PLAN.md` (Phase 0 rows), `.gitignore`
**Commands run:** `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run check` (all four together)
**Result:** `npm run check` green — 0 format issues, 0 lint findings, 0 typecheck errors, **9/9 tests passed**. Real tail:
```
Test Files  1 passed (1)
     Tests  9 passed (9)
  Start at  15:49:32
  Duration  1.19s
```
**Decisions:**
- Git repo initialized at the project root (`git init`, branch `backend-build`) — none existed before this session.
- **Two corrections to Session 1's `docs/TECH_DECISIONS.md`, found only once real installs/builds were attempted** (both now fixed in that file, not just noted here): (1) **Node 20 is end-of-life since 2026-04-30** — Session 1's research skipped verifying this because it "looked too obvious to need checking"; now targeting Node 22/24 LTS, confirmed necessary when `vitest@5`'s peer dependency rejected `@types/node@20`. (2) **Prisma 7 removed `datasource.url` from `schema.prisma`** and deprecated the `prisma-client-js` generator — `prisma generate` failed outright against the literal schema shape. Fixed with `prisma.config.ts` + `@prisma/adapter-pg` + the new `prisma-client` generator with an explicit `output` path. Neither of these was caught by Session 1's web research, which checked that each package's *major version* was current but not that the exact configuration pattern `backend.md` assumed still worked at that version — logged as a process lesson in `docs/TECH_DECISIONS.md`.
- argon2 (native bindings) installs and runs correctly on this Windows dev machine — no `@node-rs/argon2` fallback needed.
- Linter/formatter choice (not pinned by any source document): **Biome**, single tool for both, chosen after a dated check that it's the 2026-standard default for new TypeScript/Node projects — see `docs/TECH_DECISIONS.md` if a "why Biome" entry is added there; recorded here in the interim.
- `/health/live` and `/health/ready` intentionally return plain bodies, not the `{ok,data}` envelope — they're infra probes read by orchestrators/uptime checks, not API consumers expecting REQ-API-004's shape.
- `exactOptionalPropertyTypes` was tried and dropped from `tsconfig.json` — it produced repeated friction against Fastify's own (and its ecosystem's) type definitions for no functional benefit at this project's scope; `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, and `noFallthroughCasesInSwitch` are kept.
**Blocked / not verified in this sandbox (no fabrication — flagging honestly per CLAUDE.md §4):**
- **No Docker is available in this execution environment** (checked via both Bash and PowerShell — no `docker` binary, no Docker service). `docker-compose.yml` is written and believed correct but **`docker compose up` has never actually been run**.
- A **pre-existing, unrelated PostgreSQL server** is already running on this machine at `localhost:5432` (verified via `Get-Process` → `postgres.exe`, PID 7892) — not something this session set up, and its credentials are unknown. It was deliberately **not used or modified** to avoid touching shared infrastructure outside this project's scope without asking first. `/health/ready` correctly returns `503` against it (auth failure with the dummy `.env` credentials), which is itself evidence the failure path works — but **a real, successful `/health/ready` → 200, and the baseline migration's `up`/apply, have not been demonstrated against a real, correctly-provisioned database.**
- The baseline migration (`prisma/migrations/20260918095927_baseline/`) was **hand-written**, not generated by `prisma migrate dev`, because that command also requires a live DB connection to run its shadow-database diff. It contains no SQL (correct, since `schema.prisma` has zero models) but its format has not been validated by the real Prisma CLI against a real database.
- **Action needed from the user (or a future session) wherever Docker/a provisioned Postgres is actually available:** run `docker compose up -d`, `npx prisma migrate dev` (or `deploy`), confirm `/health/ready` returns `200`, and confirm `docker compose up postgres-test-init` successfully creates `swc_test`.
**Next task:** REQ-USER-001/002, REQ-AUTH-001..017, REQ-ROLE-001..008 — Session 3 (Auth, RBAC, Users), per `docs/PROJECT_PLAN.md` Phase 2. Before starting: run the Docker verification steps above wherever possible, since Session 3's own tests will need a real, reachable Postgres.
