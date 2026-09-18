# Swasthya Card — Backend

Node 20 + TypeScript + Fastify 5 + Prisma 7 + PostgreSQL 16. See `../docs/` for
the full requirement ledger, architecture, data model, API contract, security
threat table, and tech decisions this backend is built against.

## Prerequisites

- Node.js 22 (Maintenance LTS) or 24 (Active LTS) — **not 20, which reached end-of-life on 2026-04-30** — and npm
- Docker + Docker Compose (for PostgreSQL, Redis, MinIO)
- `make` (optional — every `make` target is a thin wrapper over an npm script;
  use the npm script directly if `make` isn't available, e.g. on a stock
  Windows shell without GNU Make installed)

## Clone to running

```bash
cd backend
npm install
cp .env.example .env
# Edit .env: at minimum set real values for JWT_SECRET and GRANT_SECRET
# (32+ random characters each, different from each other).

docker compose up -d
# Wait for postgres to report healthy, then create the test database once:
docker compose up postgres-test-init

npx prisma generate
npx prisma migrate dev

npm run dev
```

The API is now listening on `http://localhost:3000`.

```bash
curl http://localhost:3000/health/live    # {"status":"ok"}
curl http://localhost:3000/health/ready   # {"status":"ok"} once Postgres is reachable
```

## Object storage (MinIO)

After `docker compose up -d`, create the `swc-docs` bucket once, either via the
MinIO console at `http://localhost:9001` (user `minio` / password `minio123`)
or the `mc` CLI. Document upload endpoints won't work until this bucket
exists — this only matters starting with the Documents module (a later
session); nothing in the current foundation skeleton touches storage.

If testing from a phone (not this machine), MinIO must be reachable at a
non-`localhost` address — set `S3_PUBLIC_ENDPOINT` in `.env` to a tunnel URL,
or proxy uploads through the API instead (see `docs/TECH_DECISIONS.md`'s MinIO
section for the known presigned-URL/MinIO signature gotcha).

## Everyday commands

| Command | Does |
|---|---|
| `make install` / `npm install` | install dependencies |
| `make up` / `docker compose up -d` | start Postgres, Redis, MinIO |
| `make down` / `docker compose down` | stop them |
| `make migrate` / `npm run migrate` | apply pending Prisma migrations (dev) |
| `make seed` / `npm run seed` | run `prisma/seed.ts` |
| `npm run demo:reset` | reset the dev database and reseed (once seed data exists) |
| `make test` / `npm run test` | run the vitest suite once |
| `make check` / `npm run check` | format-check, lint, typecheck, test — must be green before any commit |
| `npm run dev` | run the API with hot reload (`tsx watch`) |
| `npm run build` / `npm run start` | compile to `dist/` and run the compiled output |

## Running tests

Tests run against the **real** `swc_test` Postgres database (never SQLite,
never a mock — CLAUDE.md §10), pointed at via `TEST_DATABASE_URL` in `.env`.
`npm test` overrides `DATABASE_URL` to `TEST_DATABASE_URL` automatically
(`test/setup.ts`) so the dev database is never touched by the test run.

## Current status (Phase 0 — Foundation)

This is an empty, verified skeleton: health endpoints, the global error
envelope, structured logging with request-id propagation, environment
validation, and the Prisma/CI/test wiring exist; no business endpoints exist
yet. See `docs/PROJECT_PLAN.md` for what's next.
