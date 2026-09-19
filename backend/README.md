# Swasthya Card — Backend

Node 22/24 + TypeScript + Fastify 5 + Prisma 7 + PostgreSQL 16 + Redis. See
`../docs/` for the full requirement ledger, architecture, data model, API
contract, security threat table, tech decisions, and per-session progress log
this backend is built against. `../docs/FINAL_AUDIT.md` is the authoritative,
requirement-by-requirement status of what's actually built and verified.

## Current status

Foundation, Auth (login/PIN/tokens/RBAC), Patients (family profiles), Access
Grants (QR sharing), Visits (clinical encounters), Maternal (pregnancy
registration, the 8-contact ANC schedule, server-side triage, delivery),
Facilities/code lists/meta (nearby search, picklists, the shared rules
table, feature flags), and Reminders & SMS (60s worker, mock/Sparrow
adapters, bilingual BS-date templates, demo SMS panel) are built and
verified. Everything else in `docs/PROJECT_PLAN.md` (Sync, Documents, most
seed data) is not yet started — see `docs/FINAL_AUDIT.md` and
`docs/PROGRESS.md`'s Session 11 entry for the exact per-requirement
breakdown.

## Prerequisites

- Node.js 22 (Maintenance LTS) or 24 (Active LTS) — **not 20, which reached
  end-of-life on 2026-04-30** — and npm
- A reachable PostgreSQL 16 and Redis (7+). Two ways to get both — pick one:
  - **Docker** (the originally-designed path): Docker + Docker Compose.
    **Not verified end-to-end in any session so far** — this environment has
    never had Docker available. If you use this path and hit something the
    steps below don't cover, please fix it forward in this README.
  - **Portable binaries, no Docker/no admin rights** (what every session so
    far has actually run against): see [Local setup without Docker](#local-setup-without-docker)
    below. This is the verified path.
- `make` (optional — every `make` target is a thin wrapper over an npm
  script; use the npm script directly if `make` isn't available, e.g. on a
  stock Windows shell without GNU Make installed)

## Clone to running (Docker path)

```bash
cd backend
npm install
cp .env.example .env
# Edit .env: at minimum set real values for JWT_SECRET and GRANT_SECRET
# (32+ random characters each, different from each other - config.ts now
# refuses to boot if they're equal).

docker compose up -d
docker compose up postgres-test-init   # creates the swc_test database once

npx prisma generate
npx prisma migrate deploy

npm run dev
```

## Local setup without Docker

This is the path actually used and verified across every session so far, on
a machine with no Docker, no WSL, and no admin rights. Both Postgres and
Redis run as **plain background processes** (not services) — they do not
survive a reboot; see the restart commands at the end of this section.

1. Download portable, no-installer binaries:
   - PostgreSQL 17 Windows x64 **binaries zip** (not the installer) from
     EnterpriseDB.
   - A Redis-compatible Windows build, e.g. from the `redis-windows/redis-windows`
     GitHub releases.
2. Extract both somewhere outside this repo (e.g. `%LOCALAPPDATA%\swc-dev\`).
3. Initialize a fresh Postgres data directory and start it on a free port
   (5432/5433 may already be in use by something else on your machine — pick
   whatever's actually free):
   ```powershell
   <pgsql>\bin\initdb.exe -D <datadir> -U swc --pwfile=<file containing "swc"> -E UTF8 --locale=C
   <pgsql>\bin\pg_ctl.exe -D <datadir> -l <datadir>\..\server.log -o "-p 5544" start
   ```
4. Create the two databases:
   ```powershell
   $env:PGPASSWORD = "swc"
   <pgsql>\bin\createdb.exe -h 127.0.0.1 -p 5544 -U swc swc
   <pgsql>\bin\createdb.exe -h 127.0.0.1 -p 5544 -U swc swc_test
   ```
5. Start Redis directly (no config file needed):
   ```powershell
   <redis>\redis-server.exe --port 6379
   ```
6. `cp .env.example .env`, then edit `DATABASE_URL`/`TEST_DATABASE_URL` to
   point at whatever host/port you used in step 3 (e.g.
   `postgresql://swc:swc@localhost:5544/swc`), and set real `JWT_SECRET`/
   `GRANT_SECRET` values.
7. `npm install && npx prisma generate`
8. Apply migrations to **both** databases (see [Migrations](#migrations) below).
9. `npm run dev`, or `npm run check` to verify everything end to end.

**Restarting after a reboot** (adjust paths to match your install):

```powershell
<pgsql>\bin\pg_ctl.exe -D <datadir> -l <datadir>\..\server.log -o "-p 5544" start
<redis>\redis-server.exe --port 6379
```

## Migrations

Every schema change ships as a Prisma migration with a matching, hand-written
`down.sql` in the same migration folder (Prisma itself has no down-migration
runner — see CLAUDE.md §9).

**Apply pending migrations** (dev, against `DATABASE_URL`):
```bash
npx prisma migrate dev
```

**Apply pending migrations** (production/CI, against whatever `DATABASE_URL`
is set to — never generates a new migration, only applies existing ones):
```bash
npx prisma migrate deploy
```

Remember the test database needs migrating too, separately, since it's a
different connection string:
```bash
DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy
```
(On Windows PowerShell: `$env:DATABASE_URL = $env:TEST_DATABASE_URL; npx prisma migrate deploy`.)

**Rolling back the most recent migration**, if something needs to be undone:
```bash
psql "$DATABASE_URL" -f prisma/migrations/<timestamp>_<name>/down.sql
```
Then tell Prisma's own migration tracking about it so a later `migrate
deploy` doesn't think the migration is still applied:
```sql
DELETE FROM _prisma_migrations WHERE migration_name = '<timestamp>_<name>';
```
This has been exercised for real against a live database every time a
migration was added (see `docs/PROGRESS.md`'s Session 3–6 entries) — it is
not a theoretical procedure.

## Object storage (MinIO)

Not needed yet — the Documents module (`REQ-DOC-*`) hasn't been built. When
it is, this section will cover creating the `swc-docs` bucket and the
presigned-URL/MinIO signature gotcha already researched in
`docs/TECH_DECISIONS.md`.

## Everyday commands

| Command | Does |
|---|---|
| `make install` / `npm install` | install dependencies |
| `make up` / `docker compose up -d` | start Postgres, Redis, MinIO (Docker path only) |
| `make down` / `docker compose down` | stop them (Docker path only) |
| `make migrate` / `npm run migrate` | apply pending Prisma migrations (dev) |
| `make seed` / `npm run seed` | run `prisma/seed.ts` (currently a no-op placeholder — seed data isn't built yet) |
| `npm run demo:reset` | reset the dev database and reseed (once seed data exists) |
| `make test` / `npm run test` | run the vitest suite once |
| `make check` / `npm run check` | format-check, lint, typecheck, test — must be green before any commit |
| `npm run dev` | run the API with hot reload (`tsx watch`) |
| `npm run build` / `npm run start` | compile to `dist/` and run the compiled output |
| `npm run openapi:export` | regenerate `../docs/openapi.json` from the live route definitions |

## Running tests

Tests run against the **real** `swc_test` Postgres database and a **real**
Redis (never SQLite, never a mock — CLAUDE.md §10), pointed at via
`TEST_DATABASE_URL`/`REDIS_URL` in `.env`. `npm test` overrides `DATABASE_URL`
to `TEST_DATABASE_URL` automatically (`test/setup.ts`) so the dev database is
never touched by the test run. Test files run sequentially, not in parallel
(`vitest.config.ts`'s `fileParallelism: false`) — every test truncates and
reuses the same database, which isn't safe across concurrent files; see that
file's comment for the full reasoning.

## Deployment notes

This has only ever run in local development. Before any real deployment:

- **CORS**: `CORS_ORIGINS=*` is explicitly documented (`docs/SECURITY.md` row 10)
  as hackathon-only. Set it to a real, comma-separated origin allowlist.
- **Secrets**: generate real, random `JWT_SECRET`/`GRANT_SECRET` (32+ chars,
  genuinely different from each other — enforced at startup). Never reuse the
  `dev-only-...` values from `.env.example`.
- **Connection pooling**: `src/lib/prisma.ts`'s `PrismaPg` adapter wraps
  `node-postgres`'s `pg.Pool`, which defaults to a max of 10 connections — not
  currently overridden. Fine at this project's documented scale (dozens of
  users per deployment, per `docs/DATA_MODEL.md`'s own reasoning), but revisit
  if that assumption changes. `ioredis` similarly runs with library defaults
  for connect/command timeouts.
- **Log level**: defaults to `info`, safe for production as-is; never set to
  `debug` in production (no secrets are ever logged at any level, but debug
  output is noisier than an orchestrator's log pipeline usually wants).
- **Migrations**: run `npx prisma migrate deploy` (never `migrate dev`) as
  part of the deploy step, before the new app version starts serving traffic.
- **Health checks**: point the orchestrator's liveness probe at
  `/health/live` (process up, no dependency check) and its readiness probe at
  `/health/ready` (also checks Postgres + Redis are reachable).
- **Graceful shutdown**: the process handles `SIGINT`/`SIGTERM`, stops
  accepting new requests, waits for in-flight ones (bounded to a 10s hard
  timeout, then force-exits) — send a graceful signal, don't `SIGKILL`
  directly, in any orchestrator's stop sequence.
- Object storage (MinIO) and any outbound SMS/AI provider are not yet part of
  this backend's built surface (Documents/Reminders modules, `docs/PROJECT_PLAN.md`
  Phase 8/9) — nothing to configure for them yet.
